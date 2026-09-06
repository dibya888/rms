import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ownerContext } from './owner-context';

export type AccessTokenClaims = { sub: string; email: string; firstName?: string };

type AuthenticatedRequest = Request & { user?: AccessTokenClaims };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('access token is required');

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'development-access-secret',
      });
      ownerContext.enter(request.user.sub);
      return true;
    } catch {
      throw new UnauthorizedException('access token is invalid or expired');
    }
  }
}
