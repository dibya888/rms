import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminController } from './admin.controller';
import { CleanDatabaseDto } from './admin.dto';

function buildTransaction() {
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
