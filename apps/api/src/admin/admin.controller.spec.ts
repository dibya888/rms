import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';
import { CleanDatabaseDto, DeletePropertyDto, DeleteUserDto } from './admin.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles, ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

// Returned as Record<string, any>: `extra` merges in call-specific mock
// properties (e.g. `user`, `userRole` for the deleteUser tests below), and
// those don't appear in this function's own literal return type — without
// the widened return type, TS only sees the fixed properties listed here
// and rejects `transaction.user...` at every call site that relies on
// `extra` to add one.
function buildTransaction(extra: Record<string, unknown> = {}): Record<string, any> {
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

// Every admin route is protected by the class-level @UseGuards(AccessTokenGuard,
// RolesGuard) + @Roles('SYSTEM_ADMIN'). This is what actually stops a normal
// (non-admin) caller from reaching any /admin/* endpoint, and what lets a
// SYSTEM_ADMIN through — RolesGuard.spec.ts already covers the guard's own
// allow/deny behaviour for a given role set; this test confirms that
// behaviour is really wired onto AdminController and hasn't been narrowed to
// only some of its routes (Nest applies class-level metadata to every
// handler, including ones added after this check was written).
describe('AdminController authorization wiring', () => {
  it('requires AccessTokenGuard + RolesGuard, and the SYSTEM_ADMIN role, on the whole controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([AccessTokenGuard, RolesGuard]));

    const roles = Reflect.getMetadata(ROLES_KEY, AdminController);
    expect(roles).toEqual(['SYSTEM_ADMIN']);
  });

  it('the Roles decorator stores metadata under the key RolesGuard actually reads', () => {
    class Probe {}
    Roles('SYSTEM_ADMIN')(Probe);
    expect(Reflect.getMetadata(ROLES_KEY, Probe)).toEqual(['SYSTEM_ADMIN']);
  });
});

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

describe('DeletePropertyDto validation', () => {
  it('rejects a missing or empty confirmation', async () => {
    const missing = await validate(plainToInstance(DeletePropertyDto, {}));
    expect(missing.find((error) => error.property === 'confirmation')).toBeDefined();

    const empty = await validate(plainToInstance(DeletePropertyDto, { confirmation: '' }));
    expect(empty.find((error) => error.property === 'confirmation')).toBeDefined();
  });

  it('accepts any non-empty string (matched against the real property name in the controller)', async () => {
    const dto = plainToInstance(DeletePropertyDto, { confirmation: 'Green View Apartments' });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('AdminController.deleteProperty', () => {
  function buildPropertyTransaction(overrides: { property: Record<string, unknown> | null }) {
    return {
      property: {
        findFirst: jest.fn().mockResolvedValue(overrides.property),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      payment: { deleteMany: jest.fn().mockResolvedValue({ count: 147 }) },
      rentBill: { deleteMany: jest.fn().mockResolvedValue({ count: 38 }) },
      moveOutSettlement: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      repair: { deleteMany: jest.fn().mockResolvedValue({ count: 8 }) },
      leaseAgreement: { deleteMany: jest.fn().mockResolvedValue({ count: 19 }) },
      tenant: { deleteMany: jest.fn().mockResolvedValue({ count: 19 }) },
      unit: { deleteMany: jest.fn().mockResolvedValue({ count: 24 }) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
  }

  it('rejects a confirmation that does not match the property name, before deleting anything', async () => {
    const transaction = buildPropertyTransaction({ property: { id: 'prop-1', name: 'Green View Apartments', ownerId: 'owner-1', units: [{ id: 'unit-1' }] } });
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    await expect(controller.deleteProperty('prop-1', { confirmation: 'wrong name' }, request)).rejects.toThrow('confirmation must match');
    expect(transaction.property.delete).not.toHaveBeenCalled();
    expect(transaction.unit.deleteMany).not.toHaveBeenCalled();
  });

  it('404s when the property does not exist (or is already soft-deleted)', async () => {
    const transaction = buildPropertyTransaction({ property: null });
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    await expect(controller.deleteProperty('missing', { confirmation: 'anything' }, request)).rejects.toThrow('property not found');
  });

  it('deletes every dependent record scoped to the property\'s units, in FK-safe order, then the units and the property, and logs a PROPERTY_DELETED audit entry with the real counts', async () => {
    const transaction = buildPropertyTransaction({ property: { id: 'prop-1', name: 'Green View Apartments', ownerId: 'owner-1', units: [{ id: 'unit-1' }, { id: 'unit-2' }] } });
    const prisma = { withSystemAdmin: jest.fn().mockImplementation((callback: (t: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const controller = new AdminController(prisma as never);
    const request = { user: { sub: 'admin-1' } } as never;

    const result = await controller.deleteProperty('prop-1', { confirmation: 'Green View Apartments' }, request);

    const unitIds = { in: ['unit-1', 'unit-2'] };
    expect(transaction.payment.deleteMany).toHaveBeenCalledWith({ where: { bill: { unitId: unitIds } } });
    expect(transaction.rentBill.deleteMany).toHaveBeenCalledWith({ where: { unitId: unitIds } });
    expect(transaction.moveOutSettlement.deleteMany).toHaveBeenCalledWith({ where: { unitId: unitIds } });
    expect(transaction.repair.deleteMany).toHaveBeenCalledWith({ where: { unitId: unitIds } });
    expect(transaction.leaseAgreement.deleteMany).toHaveBeenCalledWith({ where: { unitId: unitIds } });
    expect(transaction.tenant.deleteMany).toHaveBeenCalledWith({ where: { unitId: unitIds } });
    expect(transaction.unit.deleteMany).toHaveBeenCalledWith({ where: { propertyId: 'prop-1' } });
    expect(transaction.property.delete).toHaveBeenCalledWith({ where: { id: 'prop-1' } });

    // FK-safe order: payments before the bills/settlements/repairs they
    // reference, those before leases/tenants, those before units, units
    // before the property itself.
    const order = [transaction.payment.deleteMany, transaction.rentBill.deleteMany, transaction.moveOutSettlement.deleteMany, transaction.repair.deleteMany, transaction.leaseAgreement.deleteMany, transaction.tenant.deleteMany, transaction.unit.deleteMany, transaction.property.delete].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: 'owner-1',
        actorUserId: 'admin-1',
        action: 'PROPERTY_DELETED',
        details: expect.objectContaining({
          propertyId: 'prop-1',
          name: 'Green View Apartments',
          deletedData: { units: 24, tenants: 19, leases: 19, rentBills: 38, payments: 147, repairs: 8, settlements: 2 },
        }),
      }),
    }));
    expect(result).toEqual({ status: 'deleted', propertyId: 'prop-1', deletedData: { units: 24, tenants: 19, leases: 19, rentBills: 38, payments: 147, repairs: 8, settlements: 2 } });
  });
});
