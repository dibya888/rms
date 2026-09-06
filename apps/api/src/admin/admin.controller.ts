import { Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { UpdateUserRoleDto, UpdateUserStatusDto } from './admin.dto';
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
