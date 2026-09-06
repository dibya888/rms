import { ConflictException, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, ThemePreference } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 7;
const COMMON_PASSWORDS = new Set(['password123!', 'password123', 'qwerty123!', 'admin12345!']);

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
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('email is already registered');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email,
        phone: dto.phone.trim(),
        fullName: [dto.firstName, dto.middleName, dto.lastName].filter(Boolean).map((part) => part!.trim()).join(' '),
        passwordHash,
        userRoles: { create: { role: { connect: { name: 'OWNER_ADMIN' } } } },
      },
      select: { id: true, email: true, fullName: true, status: true },
    });

    const rawToken = randomBytes(32).toString('hex');
    const activationToken = await this.prisma.activationToken.create({ data: { userId: user.id, tokenHash: await argon2.hash(rawToken, { type: argon2.argon2id }), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
    await this.email.sendActivationEmail(user.email, `${activationToken.id}.${rawToken}`);

    return { user, status: 'activation_required' as const };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      if (user) await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_FAILED', details: { email: user.email } } });
      throw new UnauthorizedException('invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_FAILED', details: { email: user.email, reason: 'inactive_account' } } });
      throw new UnauthorizedException('account is not active');
    }
    if (!user.emailVerifiedAt) {
      await this.prisma.auditLog.create({ data: { ownerId: null, actorUserId: user.id, action: 'LOGIN_FAILED', details: { email: user.email, reason: 'email_unverified' } } });
      throw new UnauthorizedException('email verification is required');
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
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { themePreference: true } });
  }

  updatePreferences(userId: string, themePreference: ThemePreference) {
    return this.prisma.user.update({ where: { id: userId }, data: { themePreference }, select: { themePreference: true } });
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
