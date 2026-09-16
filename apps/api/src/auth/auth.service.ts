import { ConflictException, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, ThemePreference } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResendActivationDto, ResetPasswordDto, UpdateProfileDto, ChangePasswordDto } from './auth.dto';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 7;
const COMMON_PASSWORDS = new Set(['password123!', 'password123', 'qwerty123!', 'admin12345!']);
const ACTIVATION_TOKEN_TTL_MS = 60 * 60 * 1000;
const ACTIVATION_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new ConflictException('password and confirmPassword must match');
    }
    if (COMMON_PASSWORDS.has(dto.password.toLowerCase())) {
      throw new ConflictException('choose a less common password');
    }

    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();
    // Checked separately (rather than one combined OR lookup) purely so the
    // error message can say which one is taken — a combined query can't
    // tell the caller that without a second lookup anyway.
    const [existingEmail, existingUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.user.findUnique({ where: { username } }),
    ]);
    if (existingEmail) throw new ConflictException('email is already registered');
    if (existingUsername) throw new ConflictException('username is already taken');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        phone: dto.phone.trim(),
        fullName: [dto.firstName, dto.middleName, dto.lastName].filter(Boolean).map((part) => part!.trim()).join(' '),
        passwordHash,
        userRoles: { create: { role: { connect: { name: 'OWNER_ADMIN' } } } },
      },
      select: { id: true, email: true, username: true, fullName: true, status: true },
    });

    await this.issueActivationEmail(user.id, user.email);

    return { user, status: 'activation_required' as const };
  }

  async login(dto: LoginDto) {
    // The identifier may be either the account's email or its username —
    // both are stored lowercased, so the lookup normalizes the same way.
    const identifier = dto.identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      if (user) await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_FAILED', details: { email: user.email } } });
      throw new UnauthorizedException('invalid credentials');
    }
    if (user.status !== 'ACTIVE') {
      await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_FAILED', details: { email: user.email, reason: 'inactive_account' } } });
      throw new UnauthorizedException('account is not active');
    }
    if (!user.emailVerifiedAt) {
      const resent = await this.issueActivationEmail(user.id, user.email);
      await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_FAILED', details: { email: user.email, reason: 'email_unverified', activationEmailResent: resent } } });
      throw new UnauthorizedException('email verification is required; a new verification link has been sent to your email');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_SUCCESS', details: { email: user.email } } });
    return this.issueTokens(user.id, user.email, undefined, user.fullName.trim().split(/\s+/)[0]);
  }

  async activate(token: string) {
    const [tokenId, rawToken] = token.split('.', 2);
    const activationToken = await this.prisma.activationToken.findUnique({ where: { id: tokenId } });
    if (!activationToken || activationToken.usedAt || activationToken.expiresAt <= new Date() || !rawToken || !(await argon2.verify(activationToken.tokenHash, rawToken))) throw new UnauthorizedException('activation link is invalid or expired');
    await this.prisma.activationToken.update({ where: { id: activationToken.id }, data: { usedAt: new Date() } });
    await this.prisma.user.update({ where: { id: activationToken.userId }, data: { emailVerifiedAt: new Date() } });
    return { status: 'activated' as const };
  }

  async resendActivation(dto: ResendActivationDto) {
    const identifier = dto.identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
    if (user && !user.emailVerifiedAt) {
      const resent = await this.issueActivationEmail(user.id, user.email);
      if (resent) await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'ACTIVATION_EMAIL_RESENT', details: { email: user.email, source: 'manual_request' } } });
    }
    // Always respond the same way whether or not the account exists or is
    // already verified, so this endpoint can't be used to probe emails.
    return { status: 'accepted' as const };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('invalid refresh token');
    }

    return this.prisma.withOwner(payload.sub, async (transaction) => {
      const session = await transaction.refreshSession.findUnique({ where: { id: payload.sid }, include: { user: true } });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.id !== payload.sub) throw new UnauthorizedException('refresh session is invalid');
      if (!(await argon2.verify(session.tokenHash, refreshToken))) throw new UnauthorizedException('refresh token is invalid');
      await transaction.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return this.issueTokens(session.user.id, session.user.email, transaction, session.user.fullName.trim().split(/\s+/)[0]);
    });
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    try {
      const payload = await this.jwt.verifyAsync<{ sid: string }>(refreshToken, { secret: this.refreshSecret });
      const session = await this.prisma.refreshSession.findUnique({ where: { id: payload.sid }, select: { userId: true } });
      if (session) await this.prisma.withOwner(session.userId, async (transaction) => {
        await transaction.refreshSession.updateMany({ where: { id: payload.sid, revokedAt: null }, data: { revokedAt: new Date() } });
        await transaction.auditLog.create({ data: { ownerId: null, actorUserId: session.userId, action: 'LOGOUT', details: { sessionId: payload.sid } } });
      });
    } catch {
      // Logout is idempotent even when the cookie is expired or malformed.
    }
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (user) {
      const rawToken = randomBytes(32).toString('hex');
      const token = await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: await argon2.hash(rawToken, { type: argon2.argon2id }), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
      await this.email.sendPasswordReset(user.email, `${token.id}.${rawToken}`);
    }
    return { status: 'accepted' as const };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.confirmPassword || COMMON_PASSWORDS.has(dto.password.toLowerCase())) throw new ConflictException('password confirmation or password policy is invalid');
    const [tokenId, rawToken] = dto.token.split('.', 2);
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { id: tokenId } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || !rawToken || !(await argon2.verify(resetToken.tokenHash, rawToken))) throw new UnauthorizedException('reset token is invalid or expired');
    await this.prisma.withOwner(resetToken.userId, async (transaction) => {
      await transaction.user.update({ where: { id: resetToken.userId }, data: { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) } });
      await transaction.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } });
      await transaction.refreshSession.updateMany({ where: { userId: resetToken.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await transaction.auditLog.create({ data: { ownerId: null, actorUserId: resetToken.userId, action: 'PASSWORD_CHANGED', details: { source: 'password_reset' } } });
    });
    return { status: 'reset' as const };
  }

  getPreferences(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { themePreference: true, currencyCode: true, timeFormat: true } });
  }

  updatePreferences(userId: string, changes: { theme?: ThemePreference; currencyCode?: string; timeFormat?: string }) {
    const data: { themePreference?: ThemePreference; currencyCode?: string; timeFormat?: string } = {};
    if (changes.theme) data.themePreference = changes.theme;
    if (changes.currencyCode) data.currencyCode = changes.currencyCode;
    if (changes.timeFormat) data.timeFormat = changes.timeFormat;
    return this.prisma.user.update({ where: { id: userId }, data, select: { themePreference: true, currencyCode: true, timeFormat: true } });
  }

  getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, username: true, fullName: true, phone: true, themePreference: true, emailVerifiedAt: true, createdAt: true },
    });
  }

  // Role names for the current session. Looked up from the DB rather than
  // trusted from the JWT payload (the access token only carries sub/email/
  // firstName — no roles), so this stays correct even if a role changes
  // mid-session. Used by GET /auth/me so the frontend can route a
  // SYSTEM_ADMIN-only account (no OWNER_ADMIN role) straight to the admin
  // control center instead of trying to load an owner dashboard it has no
  // data for.
  async getRoles(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({ where: { userId }, select: { role: { select: { name: true } } } });
    return userRoles.map((userRole) => userRole.role.name);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.username !== undefined) {
      const username = dto.username.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== userId) throw new ConflictException('username is already taken');
      data.username = username;
    }
    return this.prisma.user.update({ where: { id: userId }, data, select: { id: true, email: true, username: true, fullName: true, phone: true } });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) throw new ConflictException('newPassword and confirmNewPassword must match');
    if (COMMON_PASSWORDS.has(dto.newPassword.toLowerCase())) throw new ConflictException('choose a less common password');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) throw new UnauthorizedException('current password is incorrect');

    await this.prisma.withOwner(userId, async (transaction) => {
      await transaction.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(dto.newPassword, { type: argon2.argon2id }) } });
      // Revoking every refresh session forces re-authentication everywhere
      // else the account is signed in, the same as a forgot-password reset.
      await transaction.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await transaction.auditLog.create({ data: { ownerId: null, actorUserId: userId, action: 'PASSWORD_CHANGED', details: { source: 'profile_settings' } } });
    });

    return { status: 'changed' as const };
  }

  // Creates a fresh activation token and emails it, unless an unused,
  // unexpired token was already issued within the cooldown window (guards
  // against a login-retry loop or repeated resend requests flooding inboxes).
  // Returns whether an email was actually sent.
  private async issueActivationEmail(userId: string, email: string) {
    const recentToken = await this.prisma.activationToken.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() }, createdAt: { gt: new Date(Date.now() - ACTIVATION_RESEND_COOLDOWN_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recentToken) return false;

    const rawToken = randomBytes(32).toString('hex');
    const activationToken = await this.prisma.activationToken.create({
      data: { userId, tokenHash: await argon2.hash(rawToken, { type: argon2.argon2id }), expiresAt: new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS) },
    });
    await this.email.sendActivationEmail(email, `${activationToken.id}.${rawToken}`);
    return true;
  }

  private async issueTokens(userId: string, email: string, transaction?: Prisma.TransactionClient, firstName?: string) {
    const sessionId = randomUUID();
    const refreshToken = await this.jwt.signAsync({ sub: userId, sid: sessionId }, { secret: this.refreshSecret, expiresIn: `${REFRESH_DAYS}d` });
    const client = transaction ?? this.prisma;
    await client.refreshSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }),
        expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, email, firstName }, { secret: this.accessSecret, expiresIn: ACCESS_TTL });
    return { accessToken, refreshToken };
  }

  private get accessSecret() {
    return process.env.JWT_ACCESS_SECRET ?? 'development-access-secret';
  }

  private get refreshSecret() {
    return process.env.JWT_REFRESH_SECRET ?? 'development-refresh-secret';
  }

}
