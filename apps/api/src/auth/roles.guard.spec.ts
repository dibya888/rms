import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  function context(userId: string | undefined) {
    return { getHandler: jest.fn(), getClass: jest.fn(), switchToHttp: () => ({ getRequest: () => ({ user: userId ? { sub: userId } : undefined }) }) } as never;
  }

  it('allows a user with a required role', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['SYSTEM_ADMIN']) };
    const prisma = { userRole: { findMany: jest.fn().mockResolvedValue([{ role: { name: 'SYSTEM_ADMIN' } }]) } };
    await expect(new RolesGuard(reflector as never, prisma as never).canActivate(context('admin-1'))).resolves.toBe(true);
  });

  it('rejects a user without a required role', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['SYSTEM_ADMIN']) };
    const prisma = { userRole: { findMany: jest.fn().mockResolvedValue([{ role: { name: 'OWNER_ADMIN' } }]) } };
    await expect(new RolesGuard(reflector as never, prisma as never).canActivate(context('owner-1'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
