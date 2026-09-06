import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardService } from './dashboard.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('dashboard')
@UseGuards(AccessTokenGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@Req() request: AuthenticatedRequest) { return this.dashboard.summary(request.user.sub); }
}
