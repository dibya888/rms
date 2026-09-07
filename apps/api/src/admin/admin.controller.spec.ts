import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminController } from './admin.controller';
import { CleanDatabaseDto, DeleteUserDto } from './admin.dto';

function buildTransaction(extra: Record<string, unknown> = {}) {
  const countingDeleteMany = () => jest.fn().mockResolvedValue({ count: 1 });
  return {
    payment: { deleteMany: countingDeleteMany() },
    rentBill: { deleteMany: countingDeleteMany() },
    moveOutSettlement: { deleteMany: countingDeleteMany() },
    repair: { deleteMany: countingDeleteMany() },
    leaseAgreement: { deleteMany: countingDeleteMany() },
    tenant: { deleteMany: countingDeleteMany() },
    unit: { deleteMany: countingDeleteMany() },
    billDefault: { deleteMany: countingDeleteMany() },
    property: { deleteMany: countingDeleteMany() },
    auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    ...extra,
  };
}

describe('CleanDatabaseDto validation', () => {
  it('rejects a missing or incorrect confirmation phrase', async () => {
    const wrongPhrase = await validate(plainToInstance(CleanDatabaseDto, { confirmation: 'delete everything' }));
    expect(wrongPhrase.find((error) => error.property === 'confirmation')).toBeDefined();

    const missing = await validate(plainToInstance(CleanDatabaseDto, {}));
    expect(missing.find((error) => error.property === 'confirmation')).toBeDefined();
  });

  it('accepts the exact confirmation phrase, with an optional ownerId', async () => {
    const dto = plainToInstance(CleanDatabaseDto, { confirmation: 'DELETE ALL DATA' });
    expect(await validate(dto)).toHaveLength(0);

    const scoped = plainToInstance(CleanDatabaseDto, { confirmation: 'DELETE ALL DATA', ownerId: '11111111-1111-1111-1111-111111111111' });
    expect(await validate(scoped)).toHaveLength(0);
  });
});

describe('DeleteUserDto validation', () => {
  it('requires a valid email as the confirmation', async () => {
    const invalid = await validate(plainToInstance(DeleteUserDto, { confirmation: 'not-an-email' }));
    expect(invalid.find((error) => error.property === 'confirmation')).toBeDefined();

    const missing = await validate(plainToInstance(DeleteUserDto, {}));
    expect(missing.find((error) => error.property === 'confirmation')).toBeDefined();
  });

  it('accepts a well-formed email', async () => {
    const dto = plainToInstance(DeleteUserDto, { confirmation: 'owner@example.com' });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('DeleteUserDto validation', () => {
  it('requires a well-formed email as confirmation', async () => {
    const invalid = await validate(plainToInstance(DeleteUserDto, { confirmation: 'not-an-email' }));
    expect(invalid.find((error) => error.property === 'confirmation')).toBeDefined();

    const missing = await validate(plainToInstance(DeleteUserDto, {}));
    expect(missing.find((error) => error.property === 'confirmation')).toBeDefined();

    const valid = await validate(plainToInstance(DeleteUserDto, { confirmation: 'owner@example.com' }));
    expect(valid).toHaveLength(0);
  });
});

describe('AdminController.cleanDatabase', () => {
  it('wipes business data in FK-safe order and logs an audit entry when no ownerId is given', async () => {
    const transaction = buildTransaction();
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    const result = await controller.cleanDatabase({ confirmation: 'DELETE ALL DATA' }, request);

    expect(transaction.payment.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.rentBill.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.moveOutSettlement.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.repair.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.leaseAgreement.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.tenant.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.unit.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.billDefault.deleteMany).toHaveBeenCalledWith({ where: undefined });
    expect(transaction.property.deleteMany).toHaveBeenCalledWith({ where: undefined });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerId: null, actorUserId: 'admin-1', action: 'DATABASE_CLEANED', details: expect.objectContaining({ scope: 'all' }) }),
    }));
    expect(result).toEqual(expect.objectContaining({ status: 'cleaned', scope: 'all' }));
  });

  it('scopes the wipe to a single owner when ownerId is provided', async () => {
    const transaction = buildTransaction();
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;
    const ownerId = '11111111-1111-1111-1111-111111111111';

    const result = await controller.cleanDatabase({ confirmation: 'DELETE ALL DATA', ownerId }, request);

    expect(transaction.property.deleteMany).toHaveBeenCalledWith({ where: { ownerId } });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerId, action: 'DATABASE_CLEANED', details: expect.objectContaining({ scope: 'owner', ownerId }) }),
    }));
    expect(result).toEqual(expect.objectContaining({ status: 'cleaned', scope: 'owner' }));
  });
});

describe('AdminController.deleteUser', () => {
  function buildUserQueries(overrides: { target: Record<string, unknown>; remainingAdmins?: number }) {
    return {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(overrides.target),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      userRole: { count: jest.fn().mockResolvedValue(overrides.remainingAdmins ?? 2) },
    };
  }

  it('refuses to let an admin delete their own account, before touching the database', async () => {
    const prisma = { withSystemAdmin: jest.fn() };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    await expect(controller.deleteUser('admin-1', { confirmation: 'me@example.com' }, request)).rejects.toThrow('cannot delete your own account');
    expect(prisma.withSystemAdmin).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match the account email', async () => {
    const transaction = buildTransaction(buildUserQueries({ target: { id: 'user-2', email: 'owner@example.com', userRoles: [] } }));
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    await expect(controller.deleteUser('user-2', { confirmation: 'wrong@example.com' }, request)).rejects.toThrow('confirmation must match');
    expect(transaction.user.delete).not.toHaveBeenCalled();
  });

  it('wipes the account business data, deletes the user, and logs USER_DELETED', async () => {
    const transaction = buildTransaction(buildUserQueries({ target: { id: 'user-2', email: 'owner@example.com', userRoles: [{ role: { name: 'OWNER_ADMIN' } }] } }));
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    const result = await controller.deleteUser('user-2', { confirmation: 'owner@example.com' }, request);

    expect(transaction.property.deleteMany).toHaveBeenCalledWith({ where: { ownerId: 'user-2' } });
    expect(transaction.user.delete).toHaveBeenCalledWith({ where: { id: 'user-2' } });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: 'admin-1', action: 'USER_DELETED', details: expect.objectContaining({ userId: 'user-2', email: 'owner@example.com' }) }),
    }));
    expect(result).toEqual(expect.objectContaining({ status: 'deleted', userId: 'user-2' }));
  });

  it('blocks deleting the last remaining SYSTEM_ADMIN', async () => {
    const transaction = buildTransaction(buildUserQueries({ target: { id: 'user-2', email: 'admin2@example.com', userRoles: [{ role: { name: 'SYSTEM_ADMIN' } }] }, remainingAdmins: 1 }));
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    await expect(controller.deleteUser('user-2', { confirmation: 'admin2@example.com' }, request)).rejects.toThrow('last system administrator');
    expect(transaction.user.delete).not.toHaveBeenCalled();
  });

  it('allows deleting a SYSTEM_ADMIN when other admins remain', async () => {
    const transaction = buildTransaction(buildUserQueries({ target: { id: 'user-2', email: 'admin2@example.com', userRoles: [{ role: { name: 'SYSTEM_ADMIN' } }] }, remainingAdmins: 2 }));
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    await expect(controller.deleteUser('user-2', { confirmation: 'admin2@example.com' }, request)).resolves.toEqual(expect.objectContaining({ status: 'deleted' }));
    expect(transaction.user.delete).toHaveBeenCalledWith({ where: { id: 'user-2' } });
  });
});
