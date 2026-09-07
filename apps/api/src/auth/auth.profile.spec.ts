import { AuthService } from './auth.service';
import * as argon2 from 'argon2';

describe('profile and password management', () => {
  it('updates only the fields provided, trimmed', async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({ id: 'user-1', email: 'owner@example.com', fullName: 'New Name', phone: '017' }) } };
    const service = new AuthService(prisma as never, {} as never, {} as never);

    await service.updateProfile('user-1', { fullName: '  New Name  ' });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { fullName: 'New Name' }, select: { id: true, email: true, fullName: true, phone: true } });
  });

  it('rejects a password change when the current password is wrong', async () => {
    const user = { id: 'user-1', passwordHash: await argon2.hash('CorrectPass9!') };
    const prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) }, withOwner: jest.fn() };
    const service = new AuthService(prisma as never, {} as never, {} as never);

    await expect(service.changePassword('user-1', { currentPassword: 'WrongPass9!', newPassword: 'BrandNewPass9!', confirmNewPassword: 'BrandNewPass9!' })).rejects.toThrow('current password is incorrect');
    expect(prisma.withOwner).not.toHaveBeenCalled();
  });

  it('rejects mismatched new password confirmation before checking the current password', async () => {
    const prisma = { user: { findUniqueOrThrow: jest.fn() }, withOwner: jest.fn() };
    const service = new AuthService(prisma as never, {} as never, {} as never);

    await expect(service.changePassword('user-1', { currentPassword: 'whatever', newPassword: 'BrandNewPass9!', confirmNewPassword: 'Different9!' })).rejects.toThrow('must match');
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('updates the password hash and revokes every active session on success', async () => {
    const user = { id: 'user-1', passwordHash: await argon2.hash('CorrectPass9!') };
    const transaction = { user: { update: jest.fn().mockResolvedValue(undefined) }, refreshSession: { updateMany: jest.fn().mockResolvedValue(undefined) }, auditLog: { create: jest.fn().mockResolvedValue(undefined) } };
    const prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) }, withOwner: jest.fn().mockImplementation((_id: string, callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const service = new AuthService(prisma as never, {} as never, {} as never);

    await expect(service.changePassword('user-1', { currentPassword: 'CorrectPass9!', newPassword: 'BrandNewPass9!', confirmNewPassword: 'BrandNewPass9!' })).resolves.toEqual({ status: 'changed' });

    expect(transaction.refreshSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PASSWORD_CHANGED', actorUserId: 'user-1' }) }));
  });
});
