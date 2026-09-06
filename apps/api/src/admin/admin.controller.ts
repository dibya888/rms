import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
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

  @Get('audit-logs')
  auditLogs(@Req() request: Request & { query: { ownerId?: string } }) {
    return this.prisma.withSystemAdmin((transaction) => transaction.auditLog.findMany({ where: request.query.ownerId ? { ownerId: request.query.ownerId } : undefined, include: { actor: { select: { id: true, email: true, fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }
}
