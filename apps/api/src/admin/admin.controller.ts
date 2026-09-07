import { Body, ConflictException, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { CleanDatabaseDto, DeleteUserDto, UpdateUserRoleDto, UpdateUserStatusDto } from './admin.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';

const UNRESOLVED_BILL_STATUSES: Array<'DUE' | 'PARTIAL' | 'LATE'> = ['DUE', 'PARTIAL', 'LATE'];

@Controller('admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Platform-wide counts for the admin overview cards: account health,
  // portfolio size, and this month's cash flow across every owner. Unlike
  // the owner-facing dashboard, nothing here is scoped to a single ownerId.
  @Get('overview')
  overview() {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

      const [userCounts, unverifiedUsers, unitCounts, totalTenants, totalProperties, totalOwners, paidBills, unresolvedBills] = await Promise.all([
        transaction.user.groupBy({ by: ['status'], _count: { _all: true } }),
        transaction.user.count({ where: { emailVerifiedAt: null } }),
        transaction.unit.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
        transaction.tenant.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        transaction.property.count({ where: { deletedAt: null } }),
        transaction.user.count({ where: { userRoles: { some: { role: { name: 'OWNER_ADMIN' } } } } }),
        transaction.rentBill.findMany({ where: { status: 'PAID', paymentDate: { gte: monthStart, lt: nextMonth } }, select: { houseRent: true, discount: true } }),
        transaction.rentBill.findMany({ where: { status: { in: UNRESOLVED_BILL_STATUSES } }, select: { total: true, paidAmount: true } }),
      ]);

      const countUsers = (status: string) => userCounts.find((item) => item.status === status)?._count._all ?? 0;
      const countUnits = (status: string) => unitCounts.find((item) => item.status === status)?._count._all ?? 0;
      const income = paidBills.reduce((sum, bill) => sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount))), new Prisma.Decimal(0));
      const outstanding = unresolvedBills.reduce((sum, bill) => sum.add(bill.total.sub(bill.paidAmount)), new Prisma.Decimal(0));

      return {
        users: { total: userCounts.reduce((sum, item) => sum + item._count._all, 0), active: countUsers('ACTIVE'), suspended: countUsers('SUSPENDED'), disabled: countUsers('DISABLED'), unverified: unverifiedUsers },
        portfolio: { totalOwners, totalProperties, totalUnits: countUnits('AVAILABLE') + countUnits('OCCUPIED'), occupiedUnits: countUnits('OCCUPIED'), totalTenants },
        billing: { thisMonthIncome: income, totalOutstanding: outstanding },
      };
    });
  }

  @Get('users')
  users() {
    return this.prisma.user.findMany({
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
    });
  }

  @Get('roles')
  roles() {
    return this.prisma.role.findMany({ select: { id: true, name: true, description: true }, orderBy: { name: 'asc' } });
  }

  @Get('audit-logs')
  auditLogs(@Req() request: Request & { query: { ownerId?: string } }) {
    return this.prisma.withSystemAdmin((transaction) => transaction.auditLog.findMany({ where: request.query.ownerId ? { ownerId: request.query.ownerId } : undefined, include: { actor: { select: { id: true, email: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }));
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
}
