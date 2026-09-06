import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: { sub: string } }>();
    if (!request.user?.sub) throw new ForbiddenException('authenticated user is required');
    const roles = await this.prisma.userRole.findMany({ where: { userId: request.user.sub }, include: { role: true } });
    if (!roles.some(({ role }) => required.includes(role.name))) throw new ForbiddenException('insufficient role');
    return true;
  }
}
