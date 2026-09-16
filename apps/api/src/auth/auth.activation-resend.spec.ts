import { AuthService } from './auth.service';
import * as argon2 from 'argon2';

function buildPrisma(user: { id: string; email: string; passwordHash: string; status: string; emailVerifiedAt: Date | null }) {
  const activationRecords: Array<{ id: string; userId: string; tokenHash: string; usedAt: Date | null; expiresAt: Date; createdAt: Date }> = [];
  let nextId = 1;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user), findFirst: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue(undefined) },
    activationToken: {
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: { createdAt: { gt: Date } } }) => {
        return activationRecords.find((record) => !record.usedAt && record.expiresAt > new Date() && record.createdAt > where.createdAt.gt) ?? null;
      }),
      create: jest.fn().mockImplementation(async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
        const record = { id: `activation-${nextId++}`, userId: data.userId, tokenHash: data.tokenHash, usedAt: null, expiresAt: data.expiresAt, createdAt: new Date() };
        activationRecords.push(record);
        return record;
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue(undefined) },
  };
  return { prisma, activationRecords };
}

describe('activation email resend behavior', () => {
  it('resends the activation link on a login attempt against an unverified account', async () => {
    const user = { id: 'user-1', email: 'owner@example.com', passwordHash: await argon2.hash('StrongPass9!'), status: 'ACTIVE', emailVerifiedAt: null };
    const { prisma } = buildPrisma(user);
    const email = { sendActivationEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(prisma as never, {} as never, email as never);

    await expect(service.login({ identifier: user.email, password: 'StrongPass9!' })).rejects.toThrow('email verification is required');
    expect(email.sendActivationEmail).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'LOGIN_FAILED', details: expect.objectContaining({ reason: 'email_unverified', activationEmailResent: true }) }) }));
  });

  it('does not spam a fresh activation email within the cooldown window on repeated login attempts', async () => {
    const user = { id: 'user-1', email: 'owner@example.com', passwordHash: await argon2.hash('StrongPass9!'), status: 'ACTIVE', emailVerifiedAt: null };
    const { prisma } = buildPrisma(user);
    const email = { sendActivationEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(prisma as never, {} as never, email as never);

    await expect(service.login({ identifier: user.email, password: 'StrongPass9!' })).rejects.toThrow('email verification is required');
    await expect(service.login({ identifier: user.email, password: 'StrongPass9!' })).rejects.toThrow('email verification is required');

    expect(email.sendActivationEmail).toHaveBeenCalledTimes(1);
  });

  it('resend-activation always returns accepted without revealing whether the account exists or is verified', async () => {
    const verifiedUser = { id: 'user-2', email: 'verified@example.com', passwordHash: 'hash', status: 'ACTIVE', emailVerifiedAt: new Date() };
    const { prisma: verifiedPrisma } = buildPrisma(verifiedUser);
    const verifiedEmail = { sendActivationEmail: jest.fn().mockResolvedValue(undefined) };
    const verifiedService = new AuthService(verifiedPrisma as never, {} as never, verifiedEmail as never);
    await expect(verifiedService.resendActivation({ identifier: verifiedUser.email })).resolves.toEqual({ status: 'accepted' });
    expect(verifiedEmail.sendActivationEmail).not.toHaveBeenCalled();

    const unknownPrisma = { user: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) } };
    const unknownEmail = { sendActivationEmail: jest.fn().mockResolvedValue(undefined) };
    const unknownService = new AuthService(unknownPrisma as never, {} as never, unknownEmail as never);
    await expect(unknownService.resendActivation({ identifier: 'nobody@example.com' })).resolves.toEqual({ status: 'accepted' });
    expect(unknownEmail.sendActivationEmail).not.toHaveBeenCalled();
  });

  it('resend-activation sends a new link and logs it for an unverified account', async () => {
    const user = { id: 'user-3', email: 'unverified@example.com', passwordHash: 'hash', status: 'ACTIVE', emailVerifiedAt: null };
    const { prisma } = buildPrisma(user);
    const email = { sendActivationEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(prisma as never, {} as never, email as never);

    await expect(service.resendActivation({ identifier: user.email })).resolves.toEqual({ status: 'accepted' });
    expect(email.sendActivationEmail).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ACTIVATION_EMAIL_RESENT' }) }));
  });
});
