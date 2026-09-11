import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { CleanDatabaseDto, DeletePropertyDto, DeleteUserDto, UpdateUserRoleDto, UpdateUserStatusDto } from './admin.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';

const UNRESOLVED_BILL_STATUSES: Array<'DUE' | 'PARTIAL' | 'LATE'> = ['DUE', 'PARTIAL', 'LATE'];
const OPEN_REPAIR_STATUSES: Array<'OPEN' | 'IN_PROGRESS'> = ['OPEN', 'IN_PROGRESS'];

type PagingQuery = { skip?: string; take?: string };

@Controller('admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Platform-wide counts for the admin overview cards and charts: account
  // health, portfolio size, this month's cash flow, repair pipeline, and a
  // trailing 6-month platform-growth/revenue trend. Unlike the owner-facing
  // dashboard, nothing here is scoped to a single ownerId.
  @Get('overview')
  overview() {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

      const [
        userCounts, unverifiedUsers, unitCounts, totalTenants, totalProperties, totalOwners,
        paidBills, unresolvedBills, repairCounts, totalLeases, totalRentBills, totalPayments,
        newUsers, newProperties, newTenants, trendBills, trendRepairs,
      ] = await Promise.all([
        transaction.user.groupBy({ by: ['status'], _count: { _all: true } }),
        transaction.user.count({ where: { emailVerifiedAt: null } }),
        transaction.unit.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
        transaction.tenant.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        transaction.property.count({ where: { deletedAt: null } }),
        transaction.user.count({ where: { userRoles: { some: { role: { name: 'OWNER_ADMIN' } } } } }),
        transaction.rentBill.findMany({ where: { status: 'PAID', paymentDate: { gte: monthStart, lt: nextMonth } }, select: { houseRent: true, discount: true } }),
        transaction.rentBill.findMany({ where: { status: { in: UNRESOLVED_BILL_STATUSES } }, select: { total: true, paidAmount: true } }),
        transaction.repair.groupBy({ by: ['status'], _count: { _all: true } }),
        transaction.leaseAgreement.count(),
        transaction.rentBill.count(),
        transaction.payment.count(),
        transaction.user.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true } }),
        transaction.property.findMany({ where: { createdAt: { gte: sixMonthsAgo }, deletedAt: null }, select: { createdAt: true } }),
        transaction.tenant.findMany({ where: { createdAt: { gte: sixMonthsAgo }, deletedAt: null }, select: { createdAt: true } }),
        transaction.rentBill.findMany({ where: { status: 'PAID', paymentDate: { gte: sixMonthsAgo, lt: nextMonth } }, select: { paymentDate: true, houseRent: true, discount: true } }),
        transaction.repair.findMany({ where: { paidBy: 'OWNER', repairDate: { gte: sixMonthsAgo, lt: nextMonth } }, select: { repairDate: true, cost: true } }),
      ]);

      const countUsers = (status: string) => userCounts.find((item) => item.status === status)?._count._all ?? 0;
      const countUnits = (status: string) => unitCounts.find((item) => item.status === status)?._count._all ?? 0;
      const countRepairs = (status: string) => repairCounts.find((item) => item.status === status)?._count._all ?? 0;
      const income = paidBills.reduce((sum, bill) => sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount))), new Prisma.Decimal(0));
      const outstanding = unresolvedBills.reduce((sum, bill) => sum.add(bill.total.sub(bill.paidAmount)), new Prisma.Decimal(0));

      // Platform growth + revenue trend, last 6 months. Only-count/only-sum
      // fields are fetched for the whole window in one query per entity,
      // then bucketed in memory — cheaper than 6 separate monthly queries
      // per entity and keeps this endpoint to a fixed, small number of
      // round trips regardless of how many months are shown.
      const growth = Array.from({ length: 6 }, (_, index) => {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        const inRange = (date: Date) => date >= start && date < end;
        return {
          month: start.toISOString().slice(0, 7),
          newUsers: newUsers.filter((user) => inRange(user.createdAt)).length,
          newProperties: newProperties.filter((property) => inRange(property.createdAt)).length,
          newTenants: newTenants.filter((tenant) => inRange(tenant.createdAt)).length,
          income: trendBills.filter((bill) => bill.paymentDate && inRange(bill.paymentDate)).reduce((sum, bill) => sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount))), new Prisma.Decimal(0)),
          repairCost: trendRepairs.filter((repair) => inRange(repair.repairDate)).reduce((sum, repair) => sum.add(repair.cost), new Prisma.Decimal(0)),
        };
      });

      return {
        users: { total: userCounts.reduce((sum, item) => sum + item._count._all, 0), active: countUsers('ACTIVE'), suspended: countUsers('SUSPENDED'), disabled: countUsers('DISABLED'), unverified: unverifiedUsers },
        portfolio: { totalOwners, totalProperties, totalUnits: countUnits('AVAILABLE') + countUnits('OCCUPIED'), occupiedUnits: countUnits('OCCUPIED'), availableUnits: countUnits('AVAILABLE'), totalTenants, totalLeases, totalRentBills, totalPayments },
        billing: { thisMonthIncome: income, totalOutstanding: outstanding },
        repairs: { open: countRepairs('OPEN'), inProgress: countRepairs('IN_PROGRESS'), completed: countRepairs('COMPLETED'), cancelled: countRepairs('CANCELLED') },
        growth,
      };
    });
  }

  // Paginated, searchable account list (matches every other admin list
  // endpoint's { items, total } shape) — plain findMany with no limit here
  // would mean loading every account into the browser at once, which is
  // exactly the failure mode flagged for large datasets.
  @Get('users')
  users(@Req() request: Request & { query: PagingQuery & { q?: string; status?: string } }) {
    const { skip, take } = this.paging(request.query);
    const q = (request.query.q ?? '').trim();
    const where: Prisma.UserWhereInput = {
      ...(request.query.status ? { status: request.query.status as Prisma.UserWhereInput['status'] } : {}),
      ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] } : {}),
    };

    return Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          status: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: { include: { role: true } },
          _count: { select: { properties: true, tenants: true, units: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  // Single-account drill-down for the admin "view as platform data" screen:
  // profile fields plus a snapshot of everything that account owns. The
  // owned-data counts touch RLS-protected tables, so they run inside the
  // same withSystemAdmin transaction as the User lookup even though User
  // itself isn't RLS-scoped.
  @Get('users/:userId')
  user(@Param('userId') userId: string) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, fullName: true, phone: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, userRoles: { include: { role: true } } },
      });
      if (!user) throw new NotFoundException('user not found');

      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

      const [properties, units, tenants, activeLeases, unresolvedBills, paymentsThisMonth, openRepairs] = await Promise.all([
        transaction.property.count({ where: { ownerId: userId, deletedAt: null } }),
        transaction.unit.count({ where: { ownerId: userId, deletedAt: null } }),
        transaction.tenant.count({ where: { ownerId: userId, deletedAt: null } }),
        transaction.leaseAgreement.count({ where: { ownerId: userId, status: 'ACTIVE' } }),
        transaction.rentBill.findMany({ where: { ownerId: userId, status: { in: UNRESOLVED_BILL_STATUSES } }, select: { total: true, paidAmount: true } }),
        transaction.payment.findMany({ where: { ownerId: userId, paidOn: { gte: monthStart, lt: nextMonth } }, select: { amount: true } }),
        transaction.repair.count({ where: { ownerId: userId, status: { in: OPEN_REPAIR_STATUSES } } }),
      ]);

      const outstanding = unresolvedBills.reduce((sum, bill) => sum.add(bill.total.sub(bill.paidAmount)), new Prisma.Decimal(0));
      const paymentsTotal = paymentsThisMonth.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));

      return { ...user, stats: { properties, units, tenants, activeLeases, outstanding, paymentsThisMonth: paymentsTotal, openRepairs } };
    });
  }

  @Get('roles')
  roles() {
    return this.prisma.role.findMany({ select: { id: true, name: true, description: true }, orderBy: { name: 'asc' } });
  }

  // Cross-entity search for the admin global search bar: users, properties,
  // tenants, and units. Each category is capped at 5 rows and matched with
  // an indexed-friendly `contains` filter — this never loads full tables
  // into memory, and short/empty queries return nothing rather than
  // scanning the whole platform.
  @Get('search')
  search(@Req() request: Request & { query: { q?: string } }) {
    const q = (request.query.q ?? '').trim();
    if (q.length < 2) return { users: [], properties: [], tenants: [], units: [] };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [users, properties, tenants, units] = await Promise.all([
        transaction.user.findMany({
          where: { OR: [{ fullName: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] },
          select: { id: true, fullName: true, email: true, status: true },
          take: 5,
        }),
        transaction.property.findMany({
          where: { deletedAt: null, OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { address: { contains: q, mode: 'insensitive' as const } }] },
          include: { owner: { select: { id: true, fullName: true } }, units: { where: { deletedAt: null }, select: { id: true, status: true } } },
          take: 5,
        }),
        transaction.tenant.findMany({
          where: { deletedAt: null, OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] },
          include: { unit: { include: { property: { select: { id: true, name: true } } } } },
          take: 5,
        }),
        transaction.unit.findMany({
          where: { deletedAt: null, unitNo: { contains: q, mode: 'insensitive' as const } },
          include: { property: { select: { id: true, name: true } } },
          take: 5,
        }),
      ]);

      return {
        users,
        properties: properties.map((property) => ({ id: property.id, name: property.name, owner: property.owner, unitCount: property.units.length, tenantCount: property.units.filter((unit) => unit.status === 'OCCUPIED').length })),
        tenants: tenants.map((tenant) => ({ id: tenant.id, name: tenant.name, phone: tenant.phone, property: tenant.unit?.property ?? null, unitNo: tenant.unit?.unitNo ?? null })),
        units: units.map((unit) => ({ id: unit.id, unitNo: unit.unitNo, status: unit.status, property: unit.property })),
      };
    });
  }

  // Platform-wide property list for the admin Properties screen: owner,
  // occupied/vacant unit counts. Supports free-text search and pagination
  // so the browser never has to load every property at once.
  @Get('properties')
  properties(@Req() request: Request & { query: PagingQuery & { q?: string } }) {
    const { skip, take } = this.paging(request.query);
    const q = (request.query.q ?? '').trim();
    const where: Prisma.PropertyWhereInput = {
      deletedAt: null,
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { address: { contains: q, mode: 'insensitive' as const } }, { owner: { fullName: { contains: q, mode: 'insensitive' as const } } }, { owner: { email: { contains: q, mode: 'insensitive' as const } } }] } : {}),
    };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [items, total] = await Promise.all([
        transaction.property.findMany({
          where,
          include: { owner: { select: { id: true, fullName: true, email: true } }, units: { where: { deletedAt: null }, select: { id: true, status: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        transaction.property.count({ where }),
      ]);

      return {
        total,
        items: items.map((property) => ({
          id: property.id,
          name: property.name,
          address: property.address,
          propertyType: property.propertyType,
          createdAt: property.createdAt,
          owner: property.owner,
          unitCount: property.units.length,
          occupiedUnits: property.units.filter((unit) => unit.status === 'OCCUPIED').length,
          vacantUnits: property.units.filter((unit) => unit.status === 'AVAILABLE').length,
        })),
      };
    });
  }

  // Full administrative view of a single property: units (with current
  // tenant), tenants, leases, billing split by status, recent payments,
  // repairs split by status, and the exact record counts that would be
  // removed by deleteProperty — used to populate the confirmation dialog
  // with real numbers instead of estimates.
  @Get('properties/:propertyId')
  property(@Param('propertyId') propertyId: string) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const property = await transaction.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        include: {
          owner: { select: { id: true, fullName: true, email: true, phone: true } },
          units: { where: { deletedAt: null }, include: { tenants: { where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true, name: true, status: true } } }, orderBy: { unitNo: 'asc' } },
        },
      });
      if (!property) throw new NotFoundException('property not found');

      const unitIds = property.units.map((unit) => unit.id);
      const whereUnit = { unitId: { in: unitIds } };

      const [tenants, leases, billStats, paymentsCount, recentPayments, repairStats, settlementsCount] = await Promise.all([
        transaction.tenant.findMany({ where: { ...whereUnit, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
        transaction.leaseAgreement.findMany({ where: whereUnit, include: { tenant: { select: { id: true, name: true } }, unit: { select: { id: true, unitNo: true } } }, orderBy: { startDate: 'desc' } }),
        transaction.rentBill.groupBy({ by: ['status'], where: whereUnit, _count: { _all: true }, _sum: { total: true, paidAmount: true } }),
        transaction.payment.count({ where: { bill: whereUnit } }),
        transaction.payment.findMany({ where: { bill: whereUnit }, include: { bill: { include: { lease: { include: { tenant: true } }, unit: true } } }, orderBy: { paidOn: 'desc' }, take: 25 }),
        transaction.repair.groupBy({ by: ['status'], where: whereUnit, _count: { _all: true }, _sum: { cost: true } }),
        transaction.moveOutSettlement.count({ where: whereUnit }),
      ]);

      const billsCount = billStats.reduce((sum, item) => sum + item._count._all, 0);
      const outstanding = billStats.filter((item) => item.status !== 'PAID').reduce((sum, item) => sum.add((item._sum.total ?? new Prisma.Decimal(0)).sub(item._sum.paidAmount ?? new Prisma.Decimal(0))), new Prisma.Decimal(0));
      const repairsCount = repairStats.reduce((sum, item) => sum + item._count._all, 0);

      return {
        id: property.id,
        name: property.name,
        address: property.address,
        phone: property.phone,
        propertyType: property.propertyType,
        createdAt: property.createdAt,
        owner: property.owner,
        units: property.units.map((unit) => ({ id: unit.id, unitNo: unit.unitNo, unitType: unit.unitType, rent: unit.rent, status: unit.status, currentTenant: unit.tenants[0] ?? null })),
        tenants,
        leases,
        billsByStatus: billStats.map((item) => ({ status: item.status, count: item._count._all, total: item._sum.total ?? new Prisma.Decimal(0), paidAmount: item._sum.paidAmount ?? new Prisma.Decimal(0) })),
        outstanding,
        recentPayments: recentPayments.map((payment) => ({ id: payment.id, amount: payment.amount, paidOn: payment.paidOn, method: payment.method, tenantName: payment.bill.lease.tenant.name, unitNo: payment.bill.unit.unitNo })),
        repairsByStatus: repairStats.map((item) => ({ status: item.status, count: item._count._all, cost: item._sum.cost ?? new Prisma.Decimal(0) })),
        deleteImpact: { units: property.units.length, tenants: tenants.length, leases: leases.length, rentBills: billsCount, payments: paymentsCount, repairs: repairsCount, settlements: settlementsCount },
      };
    });
  }

  // Permanently removes a property and every record scoped to its units —
  // tenants, leases, rent bills, payments, repairs, settlements — then the
  // units and the property itself. Deletes children before the parents
  // that reference them (same FK-safe ordering as wipeBusinessData below),
  // all inside one withSystemAdmin transaction: if any step fails, nothing
  // is removed. Requires the admin to type the property's exact name.
  //
  // Deliberately a real cascading delete rather than a Prisma
  // `onDelete: Cascade` on the schema: the relations stay explicit and
  // owner-scoped soft-deletes (see PortfolioService.deleteProperty) are
  // completely unaffected by this — this endpoint is the platform-admin
  // "permanently destroy" action, not the everyday owner delete.
  @Post('properties/:propertyId/delete')
  deleteProperty(@Param('propertyId') propertyId: string, @Body() dto: DeletePropertyDto, @Req() request: Request & { user?: { sub: string } }) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const property = await transaction.property.findFirst({ where: { id: propertyId, deletedAt: null }, include: { units: { select: { id: true } } } });
      if (!property) throw new NotFoundException('property not found');
      if (dto.confirmation.trim() !== property.name) throw new ConflictException('confirmation must match the property name exactly');

      const unitIds = property.units.map((unit) => unit.id);
      const whereUnit = { unitId: { in: unitIds } };

      const payments = await transaction.payment.deleteMany({ where: { bill: whereUnit } });
      const rentBills = await transaction.rentBill.deleteMany({ where: whereUnit });
      const settlements = await transaction.moveOutSettlement.deleteMany({ where: whereUnit });
      const repairs = await transaction.repair.deleteMany({ where: whereUnit });
      const leases = await transaction.leaseAgreement.deleteMany({ where: whereUnit });
      const tenants = await transaction.tenant.deleteMany({ where: whereUnit });
      const units = await transaction.unit.deleteMany({ where: { propertyId } });
      await transaction.property.delete({ where: { id: propertyId } });

      const deletedData = { units: units.count, tenants: tenants.count, leases: leases.count, rentBills: rentBills.count, payments: payments.count, repairs: repairs.count, settlements: settlements.count };
      await transaction.auditLog.create({ data: { ownerId: property.ownerId, actorUserId: request.user!.sub, action: 'PROPERTY_DELETED', details: { propertyId, name: property.name, deletedData } } });

      return { status: 'deleted' as const, propertyId, deletedData };
    });
  }

  // Platform-wide tenant list: owner, property/unit, most recent lease
  // status, and outstanding balance on that lease. The outstanding lookup
  // is one grouped query over the current page's lease ids, not per-row.
  @Get('tenants')
  tenantsList(@Req() request: Request & { query: PagingQuery & { q?: string } }) {
    const { skip, take } = this.paging(request.query);
    const q = (request.query.q ?? '').trim();
    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { phone: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } },
        { owner: { fullName: { contains: q, mode: 'insensitive' as const } } },
        { owner: { email: { contains: q, mode: 'insensitive' as const } } },
        { unit: { property: { name: { contains: q, mode: 'insensitive' as const } } } },
      ] } : {}),
    };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [items, total] = await Promise.all([
        transaction.tenant.findMany({
          where,
          include: { owner: { select: { id: true, fullName: true, email: true } }, unit: { include: { property: { select: { id: true, name: true } } } }, leases: { orderBy: { startDate: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        transaction.tenant.count({ where }),
      ]);

      const leaseIds = items.map((tenant) => tenant.leases[0]?.id).filter((id): id is string => Boolean(id));
      const outstandingByLease = leaseIds.length
        ? await transaction.rentBill.groupBy({ by: ['leaseId'], where: { leaseId: { in: leaseIds }, status: { in: UNRESOLVED_BILL_STATUSES } }, _sum: { total: true, paidAmount: true } })
        : [];

      return {
        total,
        items: items.map((tenant) => {
          const lease = tenant.leases[0];
          const outstandingRow = lease ? outstandingByLease.find((row) => row.leaseId === lease.id) : undefined;
          const outstanding = outstandingRow ? (outstandingRow._sum.total ?? new Prisma.Decimal(0)).sub(outstandingRow._sum.paidAmount ?? new Prisma.Decimal(0)) : new Prisma.Decimal(0);
          return {
            id: tenant.id, name: tenant.name, phone: tenant.phone, status: tenant.status, createdAt: tenant.createdAt,
            owner: tenant.owner,
            property: tenant.unit?.property ?? null,
            unit: tenant.unit ? { id: tenant.unit.id, unitNo: tenant.unit.unitNo, rent: tenant.unit.rent } : null,
            leaseStatus: lease?.status ?? null,
            rent: lease?.monthlyRent ?? tenant.unit?.rent ?? null,
            outstanding,
          };
        }),
      };
    });
  }

  // Platform-wide unit list: owner, property, and current active tenant.
  @Get('units')
  unitsList(@Req() request: Request & { query: PagingQuery & { q?: string } }) {
    const { skip, take } = this.paging(request.query);
    const q = (request.query.q ?? '').trim();
    const where: Prisma.UnitWhereInput = {
      deletedAt: null,
      ...(q ? { OR: [
        { unitNo: { contains: q, mode: 'insensitive' as const } },
        { property: { name: { contains: q, mode: 'insensitive' as const } } },
        { owner: { fullName: { contains: q, mode: 'insensitive' as const } } },
        { owner: { email: { contains: q, mode: 'insensitive' as const } } },
      ] } : {}),
    };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [items, total] = await Promise.all([
        transaction.unit.findMany({
          where,
          include: { owner: { select: { id: true, fullName: true, email: true } }, property: { select: { id: true, name: true } }, tenants: { where: { status: 'ACTIVE', deletedAt: null }, select: { id: true, name: true }, take: 1 } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        transaction.unit.count({ where }),
      ]);

      return {
        total,
        items: items.map((unit) => ({ id: unit.id, unitNo: unit.unitNo, unitType: unit.unitType, rent: unit.rent, status: unit.status, owner: unit.owner, property: unit.property, currentTenant: unit.tenants[0] ?? null })),
      };
    });
  }

  // Platform-wide payments list with owner, property, date-range, and
  // method filters — all pushed into the WHERE clause so filtering happens
  // in Postgres rather than after loading rows into the app.
  // Platform-wide payments list. `q` searches owner name/email, tenant
  // name, unit number, and property name in one box — the practical way to
  // find one exact entry among a very large table without needing a
  // separate filter control per column.
  @Get('payments')
  paymentsList(@Req() request: Request & { query: PagingQuery & { q?: string; ownerId?: string; propertyId?: string; method?: string; from?: string; to?: string } }) {
    const { skip, take } = this.paging(request.query);
    const { ownerId, propertyId, method, from, to } = request.query;
    const q = (request.query.q ?? '').trim();
    const where: Prisma.PaymentWhereInput = {
      ...(ownerId ? { ownerId } : {}),
      ...(method ? { method: method as Prisma.PaymentWhereInput['method'] } : {}),
      ...(propertyId ? { bill: { unit: { propertyId } } } : {}),
      ...(from || to ? { paidOn: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      ...(q ? { OR: [
        { owner: { fullName: { contains: q, mode: 'insensitive' as const } } },
        { owner: { email: { contains: q, mode: 'insensitive' as const } } },
        { bill: { lease: { tenant: { name: { contains: q, mode: 'insensitive' as const } } } } },
        { bill: { unit: { unitNo: { contains: q, mode: 'insensitive' as const } } } },
        { bill: { unit: { property: { name: { contains: q, mode: 'insensitive' as const } } } } },
      ] } : {}),
    };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [items, total] = await Promise.all([
        transaction.payment.findMany({
          where,
          include: { owner: { select: { id: true, fullName: true, email: true } }, bill: { include: { lease: { include: { tenant: { select: { id: true, name: true } } } }, unit: { include: { property: { select: { id: true, name: true } } } } } } },
          orderBy: { paidOn: 'desc' },
          skip,
          take,
        }),
        transaction.payment.count({ where }),
      ]);

      return {
        total,
        items: items.map((payment) => ({
          id: payment.id, amount: payment.amount, paidOn: payment.paidOn, method: payment.method,
          owner: payment.owner, tenantName: payment.bill.lease.tenant.name,
          unit: payment.bill.unit.unitNo, property: payment.bill.unit.property.name, propertyId: payment.bill.unit.property.id,
        })),
      };
    });
  }

  // Platform-wide rent-bill list. Same combined `q` search as payments,
  // plus the existing status/owner/property filters.
  @Get('rent-bills')
  rentBillsList(@Req() request: Request & { query: PagingQuery & { q?: string; status?: string; ownerId?: string; propertyId?: string } }) {
    const { skip, take } = this.paging(request.query);
    const { status, ownerId, propertyId } = request.query;
    const q = (request.query.q ?? '').trim();
    const where: Prisma.RentBillWhereInput = {
      ...(ownerId ? { ownerId } : {}),
      ...(status ? { status: status as Prisma.RentBillWhereInput['status'] } : {}),
      ...(propertyId ? { unit: { propertyId } } : {}),
      ...(q ? { OR: [
        { owner: { fullName: { contains: q, mode: 'insensitive' as const } } },
        { owner: { email: { contains: q, mode: 'insensitive' as const } } },
        { lease: { tenant: { name: { contains: q, mode: 'insensitive' as const } } } },
        { unit: { unitNo: { contains: q, mode: 'insensitive' as const } } },
        { unit: { property: { name: { contains: q, mode: 'insensitive' as const } } } },
      ] } : {}),
    };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [items, total] = await Promise.all([
        transaction.rentBill.findMany({
          where,
          include: { owner: { select: { id: true, fullName: true, email: true } }, lease: { include: { tenant: { select: { id: true, name: true } } } }, unit: { include: { property: { select: { id: true, name: true } } } } },
          orderBy: { dueDate: 'desc' },
          skip,
          take,
        }),
        transaction.rentBill.count({ where }),
      ]);

      return {
        total,
        items: items.map((bill) => ({
          id: bill.id, billMonth: bill.billMonth, dueDate: bill.dueDate, total: bill.total, paidAmount: bill.paidAmount, status: bill.status,
          owner: bill.owner, tenantName: bill.lease.tenant.name, unit: bill.unit.unitNo, property: bill.unit.property.name, propertyId: bill.unit.property.id,
        })),
      };
    });
  }

  // Platform-wide repairs list. Same combined `q` search (owner, current
  // tenant, unit, property), plus status/owner/property filters.
  @Get('repairs')
  repairsList(@Req() request: Request & { query: PagingQuery & { q?: string; status?: string; ownerId?: string; propertyId?: string } }) {
    const { skip, take } = this.paging(request.query);
    const { status, ownerId, propertyId } = request.query;
    const q = (request.query.q ?? '').trim();
    const where: Prisma.RepairWhereInput = {
      ...(ownerId ? { ownerId } : {}),
      ...(status ? { status: status as Prisma.RepairWhereInput['status'] } : {}),
      ...(propertyId ? { unit: { propertyId } } : {}),
      ...(q ? { OR: [
        { owner: { fullName: { contains: q, mode: 'insensitive' as const } } },
        { owner: { email: { contains: q, mode: 'insensitive' as const } } },
        { unit: { unitNo: { contains: q, mode: 'insensitive' as const } } },
        { unit: { property: { name: { contains: q, mode: 'insensitive' as const } } } },
        { unit: { tenants: { some: { name: { contains: q, mode: 'insensitive' as const } } } } },
      ] } : {}),
    };

    return this.prisma.withSystemAdmin(async (transaction) => {
      const [items, total] = await Promise.all([
        transaction.repair.findMany({
          where,
          include: { owner: { select: { id: true, fullName: true, email: true } }, unit: { include: { property: { select: { id: true, name: true } }, tenants: { where: { status: 'ACTIVE', deletedAt: null }, select: { name: true }, take: 1 } } } },
          orderBy: { repairDate: 'desc' },
          skip,
          take,
        }),
        transaction.repair.count({ where }),
      ]);

      return {
        total,
        items: items.map((repair) => ({
          id: repair.id, category: repair.category, description: repair.description, cost: repair.cost, status: repair.status, paidBy: repair.paidBy, repairDate: repair.repairDate,
          owner: repair.owner, unit: repair.unit.unitNo, property: repair.unit.property.name, propertyId: repair.unit.property.id, tenant: repair.unit.tenants[0]?.name ?? null,
        })),
      };
    });
  }

  @Get('audit-logs')
  auditLogs(@Req() request: Request & { query: { ownerId?: string; take?: string } }) {
    const take = Math.min(Math.max(Number(request.query.take) || 200, 1), 500);
    return this.prisma.withSystemAdmin((transaction) => transaction.auditLog.findMany({ where: request.query.ownerId ? { ownerId: request.query.ownerId } : undefined, include: { actor: { select: { id: true, email: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, take }));
  }

  @Patch('users/:userId/status')
  updateStatus(@Param('userId') userId: string, @Body() dto: UpdateUserStatusDto, @Req() request: Request & { user?: { sub: string } }) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const user = await transaction.user.update({ where: { id: userId }, data: { status: dto.status }, select: { id: true, email: true, fullName: true, status: true } });
      await transaction.auditLog.create({ data: { ownerId: null, actorUserId: request.user!.sub, action: dto.status === 'ACTIVE' ? 'USER_ENABLED' : 'USER_SUSPENDED', details: { userId, status: dto.status } } });
      return user;
    });
  }

  @Patch('users/:userId/role')
  updateRole(@Param('userId') userId: string, @Body() dto: UpdateUserRoleDto, @Req() request: Request & { user?: { sub: string } }) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const role = await transaction.role.findUniqueOrThrow({ where: { id: dto.roleId } });
      const user = await transaction.user.update({ where: { id: userId }, data: { userRoles: { deleteMany: {}, create: { roleId: role.id } } }, select: { id: true, email: true, fullName: true, userRoles: { include: { role: true } } } });
      await transaction.auditLog.create({ data: { ownerId: null, actorUserId: request.user!.sub, action: 'ROLE_CHANGED', details: { userId, roleId: role.id, role: role.name, reason: dto.reason } } });
      return user;
    });
  }

  // Permanently removes an account: their owned business data (properties,
  // units, tenants, leases, bills, payments, repairs, settlements) is wiped
  // first — same as a scoped database clean — then the user row itself is
  // deleted. Their past audit-log entries are kept for the security trail;
  // the actor reference on those rows is nulled out rather than deleted.
  // Requires the admin to type the account's exact email as confirmation,
  // blocks self-deletion, and blocks removing the last SYSTEM_ADMIN.
  @Post('users/:userId/delete')
  deleteUser(@Param('userId') userId: string, @Body() dto: DeleteUserDto, @Req() request: Request & { user?: { sub: string } }) {
    if (userId === request.user!.sub) throw new ConflictException('you cannot delete your own account');

    return this.prisma.withSystemAdmin(async (transaction) => {
      const target = await transaction.user.findUniqueOrThrow({ where: { id: userId }, include: { userRoles: { include: { role: true } } } });
      if (dto.confirmation.trim().toLowerCase() !== target.email) throw new ConflictException('confirmation must match the account email exactly');

      const isSystemAdmin = target.userRoles.some((userRole) => userRole.role.name === 'SYSTEM_ADMIN');
      if (isSystemAdmin) {
        const remainingAdmins = await transaction.userRole.count({ where: { role: { name: 'SYSTEM_ADMIN' } }, });
        if (remainingAdmins <= 1) throw new ConflictException('cannot delete the last system administrator');
      }

      const deletedData = await this.wipeBusinessData(transaction, userId);
      await transaction.user.delete({ where: { id: userId } });
      await transaction.auditLog.create({ data: { ownerId: null, actorUserId: request.user!.sub, action: 'USER_DELETED', details: { userId, email: target.email, deletedData } } });

      return { status: 'deleted' as const, userId, deletedData };
    });
  }

  // Wipes business/transactional data (properties, units, tenants, leases,
  // bills, payments, repairs, settlements). User accounts, roles, and
  // permissions are intentionally left in place. Scope to a single owner
  // with `ownerId`, or omit it to clean every owner's data. Requires an
  // exact confirmation phrase so the action can't be triggered by mistake.
  @Post('database/clean')
  cleanDatabase(@Body() dto: CleanDatabaseDto, @Req() request: Request & { user?: { sub: string } }) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const deleted = await this.wipeBusinessData(transaction, dto.ownerId);

      await transaction.auditLog.create({
        data: {
          ownerId: dto.ownerId ?? null,
          actorUserId: request.user!.sub,
          action: 'DATABASE_CLEANED',
          details: { scope: dto.ownerId ? 'owner' : 'all', ownerId: dto.ownerId ?? null, deleted },
        },
      });

      return { status: 'cleaned' as const, scope: dto.ownerId ? 'owner' : 'all', deleted };
    });
  }

  // Shared by cleanDatabase (explicit danger-zone action) and deleteUser
  // (which must wipe the account's business data before the FK-restricted
  // User row can itself be deleted). Deletes in FK-safe order: children
  // before the parents they reference. Pass no ownerId to wipe everyone.
  private async wipeBusinessData(transaction: Prisma.TransactionClient, ownerId?: string) {
    const where = ownerId ? { ownerId } : undefined;

    const payments = await transaction.payment.deleteMany({ where });
    const rentBills = await transaction.rentBill.deleteMany({ where });
    const settlements = await transaction.moveOutSettlement.deleteMany({ where });
    const repairs = await transaction.repair.deleteMany({ where });
    const leases = await transaction.leaseAgreement.deleteMany({ where });
    const tenants = await transaction.tenant.deleteMany({ where });
    const units = await transaction.unit.deleteMany({ where });
    const billDefaults = await transaction.billDefault.deleteMany({ where });
    const properties = await transaction.property.deleteMany({ where });

    return {
      payments: payments.count,
      rentBills: rentBills.count,
      settlements: settlements.count,
      repairs: repairs.count,
      leases: leases.count,
      tenants: tenants.count,
      units: units.count,
      billDefaults: billDefaults.count,
      properties: properties.count,
    };
  }

  // Clamps pagination query params to sane bounds: take defaults to 25 and
  // never exceeds 100, skip never goes negative. Keeps every list endpoint
  // above safe from being asked to load an unbounded number of rows.
  private paging(query: PagingQuery) {
    const take = Math.min(Math.max(Number(query.take) || 25, 1), 100);
    const skip = Math.max(Number(query.skip) || 0, 0);
    return { skip, take };
  }
}
