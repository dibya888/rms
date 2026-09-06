import { AuthService } from './auth.service';
import * as argon2 from 'argon2';

describe('password reset flow', () => {
  it('creates a single-use token, resets the password, and rejects token reuse', async () => {
    let resetMessage = '';
    let resetRecord: { id: string; userId: string; tokenHash: string; usedAt: Date | null; expiresAt: Date } | undefined;
    const transaction = {
      user: { update: jest.fn().mockResolvedValue(undefined) },
      passwordResetToken: { update: jest.fn().mockImplementation(async ({ data }: { data: { usedAt: Date } }) => { resetRecord!.usedAt = data.usedAt; }) },
      refreshSession: { updateMany: jest.fn().mockResolvedValue(undefined) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'owner@example.com' }) },
      passwordResetToken: {
        create: jest.fn().mockImplementation(async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
          resetRecord = { id: 'reset-1', userId: data.userId, tokenHash: data.tokenHash, expiresAt: data.expiresAt, usedAt: null };
          return { id: resetRecord.id };
        }),
        findUnique: jest.fn().mockImplementation(async () => resetRecord),
      },
      withOwner: jest.fn().mockImplementation(async (_ownerId: string, callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const email = { sendPasswordReset: jest.fn().mockImplementation(async (_address: string, token: string) => { resetMessage = token; }) };
    const jwt = {};
    const service = new AuthService(prisma as never, jwt as never, email as never);

    await service.forgotPassword({ email: 'owner@example.com' });
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(resetMessage).toMatch(/^reset-1\.[a-f0-9]{64}$/);

    await service.resetPassword({ token: resetMessage, password: 'NewStrongPass9!', confirmPassword: 'NewStrongPass9!' });
    expect(transaction.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    expect(resetRecord?.usedAt).toBeInstanceOf(Date);

    await expect(service.resetPassword({ token: resetMessage, password: 'AnotherStrongPass9!', confirmPassword: 'AnotherStrongPass9!' })).rejects.toThrow('reset token is invalid or expired');
  });

  it('activates an account once and rejects replayed activation links', async () => {
    const tokenHash = await argon2.hash('activation-secret');
    const activationRecord = { id: 'activation-1', userId: 'user-1', tokenHash, usedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) };
    const prisma = {
      activationToken: {
        findUnique: jest.fn().mockResolvedValue(activationRecord),
        update: jest.fn().mockImplementation(async () => { activationRecord.usedAt = new Date(); }),
      },
      user: { update: jest.fn().mockResolvedValue(undefined) },
    };
    const service = new AuthService(prisma as never, {} as never, {} as never);

    await expect(service.activate('activation-1.activation-secret')).resolves.toEqual({ status: 'activated' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' }, data: { emailVerifiedAt: expect.any(Date) } }));
    await expect(service.activate('activation-1.activation-secret')).rejects.toThrow('activation link is invalid or expired');
  });
});
