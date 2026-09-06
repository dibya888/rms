import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../storage.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { BillingService } from '../billing/billing.service';
import { RepairsService } from '../repairs/repairs.service';
import { ReportsService } from '../reports/reports.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PortfolioService } from './portfolio.service';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

describe('portfolio owner isolation (database)', () => {
  const prisma = new PrismaService();
  const portfolio = new PortfolioService(prisma);
  const tenancy = new TenancyService(prisma, new StorageService());
  const billing = new BillingService(prisma);
  const repairs = new RepairsService(prisma);
  const reports = new ReportsService(prisma);
  const dashboard = new DashboardService(prisma);
  let ownerA: string;
  let ownerB: string;
  let propertyA: string;
  let propertyB: string;
  let unitA: string;
  let unitB: string;
  let tenantA: string;
  let tenantB: string;
  let billA: string;
  let billB: string;
  let repairA: string;
  let repairB: string;
  let settlementA: string;
  let settlementB: string;

  beforeAll(async () => {
    await prisma.$connect();
    const users = await Promise.all([
      prisma.user.create({ data: { email: `isolation-a-${Date.now()}@example.com`, phone: '1234567', fullName: 'Isolation A', passwordHash: 'test' } }),
      prisma.user.create({ data: { email: `isolation-b-${Date.now()}@example.com`, phone: '1234567', fullName: 'Isolation B', passwordHash: 'test' } }),
    ]);
    ownerA = users[0].id;
    ownerB = users[1].id;
    propertyA = (await portfolio.createProperty(ownerA, { name: 'A property', address: 'A address', phone: '1234567', propertyType: 'RESIDENTIAL' })).id;
    propertyB = (await portfolio.createProperty(ownerB, { name: 'B property', address: 'B address', phone: '1234567', propertyType: 'RESIDENTIAL' })).id;
    unitA = (await portfolio.createUnit(ownerA, propertyA, { unitNo: 'A-1', unitType: 'FLAT', rent: 1000, unitAttributes: { bedrooms: 2, bathrooms: 1 } })).id;
    unitB = (await portfolio.createUnit(ownerB, propertyB, { unitNo: 'B-1', unitType: 'FLAT', rent: 1100, unitAttributes: { bedrooms: 2, bathrooms: 1 } })).id;
    tenantA = (await tenancy.createTenant(ownerA, { unitId: unitA, name: 'Tenant A', phone: '1234567', address: 'A address', moveInDate: '2026-09-01', monthlyRent: 1000, securityDeposit: 1000 })).id;
    tenantB = (await tenancy.createTenant(ownerB, { unitId: unitB, name: 'Tenant B', phone: '1234567', address: 'B address', moveInDate: '2026-09-01', monthlyRent: 1100, securityDeposit: 1100 })).id;
    await billing.generateBills(ownerA, { billMonth: '2026-09-01' });
    await billing.generateBills(ownerB, { billMonth: '2026-09-01' });
    billA = (await billing.listBills(ownerA))[0].id;
    billB = (await billing.listBills(ownerB))[0].id;
    repairA = (await repairs.create(ownerA, { unitId: unitA, repairDate: '2026-09-02', category: 'Plumbing', description: 'A repair', cost: 75, paidBy: 'OWNER' })).id;
    repairB = (await repairs.create(ownerB, { unitId: unitB, repairDate: '2026-09-02', category: 'Electrical', description: 'B repair', cost: 80, paidBy: 'OWNER' })).id;
    await tenancy.moveOut(ownerA, tenantA, { moveOutDate: '2026-09-15', moveOutReason: 'Lease ended' });
    await tenancy.moveOut(ownerB, tenantB, { moveOutDate: '2026-09-15', moveOutReason: 'Lease ended' });
    settlementA = await prisma.withOwner(ownerA, async (transaction) => (await transaction.moveOutSettlement.findFirstOrThrow({ where: { tenantId: tenantA } })).id);
    settlementB = await prisma.withOwner(ownerB, async (transaction) => (await transaction.moveOutSettlement.findFirstOrThrow({ where: { tenantId: tenantB } })).id);
  }, 60_000);

  afterAll(async () => {
    const owners = [ownerA, ownerB].filter(Boolean);
    for (const ownerId of owners) {
      await prisma.withOwner(ownerId, (transaction) => transaction.auditLog.deleteMany({ where: { actorUserId: ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.payment.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.rentBill.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.billDefault.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.repair.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.moveOutSettlement.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.leaseAgreement.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.tenant.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.unit.deleteMany({ where: { ownerId } }));
      await prisma.withOwner(ownerId, (transaction) => transaction.property.deleteMany({ where: { ownerId } }));
    }
    if (owners.length) await prisma.user.deleteMany({ where: { id: { in: owners } } });
    await prisma.$disconnect();
  }, 30_000);

  it('lists only the authenticated owner portfolio', async () => {
    expect((await portfolio.listProperties(ownerA)).map((property) => property.id)).toEqual([propertyA]);
    expect((await portfolio.listProperties(ownerB)).map((property) => property.id)).toEqual([propertyB]);
  });

  it('does not allow one owner to update another owner property', async () => {
    await expect(portfolio.updateProperty(ownerA, propertyB, { name: 'cross-owner mutation' })).rejects.toThrow('property not found');
  });

  it('lists only the authenticated owner units', async () => {
    expect((await portfolio.listUnits(ownerA, propertyA)).map((unit) => unit.id)).toEqual([unitA]);
    expect((await portfolio.listUnits(ownerB, propertyB)).map((unit) => unit.id)).toEqual([unitB]);
  });

  it('does not allow one owner to update or delete another owner unit', async () => {
    await expect(portfolio.updateUnit(ownerA, unitB, { rent: 1200 })).rejects.toThrow('unit not found');
    await expect(portfolio.deleteUnit(ownerA, unitB)).rejects.toThrow('unit not found');
  });

  it('lists only the authenticated owner tenants and leases', async () => {
    const tenantsA = await tenancy.listTenants(ownerA);
    const tenantsB = await tenancy.listTenants(ownerB);
    expect(tenantsA.map((tenant) => tenant.id)).toEqual([tenantA]);
    expect(tenantsA[0].leases).toHaveLength(1);
    expect(tenantsB.map((tenant) => tenant.id)).toEqual([tenantB]);
    expect(tenantsB[0].leases).toHaveLength(1);
  });

  it('does not allow one owner to create or operate on another owner tenant', async () => {
    await expect(tenancy.createTenant(ownerA, { unitId: unitB, name: 'Cross-owner tenant', phone: '1234567', address: 'Unknown', moveInDate: '2026-09-01', monthlyRent: 1100, securityDeposit: 1100 })).rejects.toThrow('unit not found');
    await expect(tenancy.previewSettlement(ownerA, tenantB)).rejects.toThrow('tenant lease not found');
    await expect(tenancy.moveOut(ownerA, tenantB, { moveOutDate: '2026-09-15', moveOutReason: 'cross-owner test' })).rejects.toThrow('active tenant not found');
  });

  it('lists only the authenticated owner bills', async () => {
    expect((await billing.listBills(ownerA)).map((bill) => bill.id)).toEqual([billA]);
    expect((await billing.listBills(ownerB)).map((bill) => bill.id)).toEqual([billB]);
  });

  it('does not allow one owner to record or undo payment on another owner bill', async () => {
    await expect(billing.recordPayment(ownerA, billB, { amount: 100, paidOn: '2026-09-05', method: 'CASH' }, ownerA)).rejects.toThrow('bill not found');
    await expect(billing.undoLatestPayment(ownerA, billB)).rejects.toThrow('bill not found');
  });

  it('lists only the authenticated owner repairs', async () => {
    expect((await repairs.list(ownerA)).map((repair) => repair.id)).toEqual([repairA]);
    expect((await repairs.list(ownerB)).map((repair) => repair.id)).toEqual([repairB]);
  });

  it('does not allow one owner to create, update, or delete another owner repair', async () => {
    await expect(repairs.create(ownerA, { unitId: unitB, repairDate: '2026-09-03', category: 'Cross-owner', description: 'Should fail', cost: 1, paidBy: 'OWNER' })).rejects.toThrow('unit not found');
    await expect(repairs.update(ownerA, repairB, { description: 'cross-owner mutation' })).rejects.toThrow('repair not found');
    await expect(repairs.remove(ownerA, repairB)).rejects.toThrow('repair not found');
  });

  it('does not allow one owner to update another owner settlement', async () => {
    await expect(tenancy.settle(ownerA, settlementB, { result: 'SETTLED', refundAmount: 0, payableAmount: 0, reason: 'cross-owner mutation' })).rejects.toThrow('settlement not found');
  });

  it('scopes transaction and repair reports to the authenticated owner', async () => {
    const transactionsA = await reports.transactions(ownerA, {});
    const transactionsB = await reports.transactions(ownerB, {});
    expect(transactionsA.rows.map((row) => row.id)).toEqual([billA]);
    expect(transactionsB.rows.map((row) => row.id)).toEqual([billB]);
    expect((await reports.repairs(ownerA, {})).map((repair) => repair.id)).toEqual([repairA]);
    expect((await reports.repairs(ownerB, {})).map((repair) => repair.id)).toEqual([repairB]);
  }, 30_000);

  it('scopes dashboard activity to the authenticated owner', async () => {
    const summaryA = await dashboard.summary(ownerA, new Date('2026-09-20T00:00:00.000Z'));
    const summaryB = await dashboard.summary(ownerB, new Date('2026-09-20T00:00:00.000Z'));
    expect(summaryA.recentRepairs.map((repair) => repair.id)).toEqual([repairA]);
    expect(summaryB.recentRepairs.map((repair) => repair.id)).toEqual([repairB]);
    expect(summaryA.recentDue.map((bill) => bill.id)).toEqual([billA]);
    expect(summaryB.recentDue.map((bill) => bill.id)).toEqual([billB]);
  }, 30_000);
});