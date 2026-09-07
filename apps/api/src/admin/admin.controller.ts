import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CleanDatabaseDto, UpdateUserRoleDto, UpdateUserStatusDto } from './admin.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';

@Controller('admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('users')
  users() {
    return this.prisma.user.findMany({ select: { id: true, email: true, fullName: true, phone: true, status: true, lastLoginAt: true, createdAt: true, userRoles: { include: { role: true } } }, orderBy: { createdAt: 'desc' } });
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

  // Wipes business/transactional data (properties, units, tenants, leases,
  // bills, payments, repairs, settlements). User accounts, roles, and
  // permissions are intentionally left in place. Scope to a single owner
  // with `ownerId`, or omit it to clean every owner's data. Requires an
  // exact confirmation phrase so the action can't be triggered by mistake.
  @Post('database/clean')
  cleanDatabase(@Body() dto: CleanDatabaseDto, @Req() request: Request & { user?: { sub: string } }) {
    return this.prisma.withSystemAdmin(async (transaction) => {
      const where = dto.ownerId ? { ownerId: dto.ownerId } : undefined;

      // Deleted in FK-safe order: children before the parents they reference.
      const payments = await transaction.payment.deleteMany({ where });
      const rentBills = await transaction.rentBill.deleteMany({ where });
      const settlements = await transaction.moveOutSettlement.deleteMany({ where });
      const repairs = await transaction.repair.deleteMany({ where });
      const leases = await transaction.leaseAgreement.deleteMany({ where });
      const tenants = await transaction.tenant.deleteMany({ where });
      const units = await transaction.unit.deleteMany({ where });
      const billDefaults = await transaction.billDefault.deleteMany({ where });
      const properties = await transaction.property.deleteMany({ where });

      const summary = {
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

      await transaction.auditLog.create({
        data: {
          ownerId: dto.ownerId ?? null,
          actorUserId: request.user!.sub,
          action: 'DATABASE_CLEANED',
          details: { scope: dto.ownerId ? 'owner' : 'all', ownerId: dto.ownerId ?? null, deleted: summary },
        },
      });

      return { status: 'cleaned' as const, scope: dto.ownerId ? 'owner' : 'all', deleted: summary };
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
}
