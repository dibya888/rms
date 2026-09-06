import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateRepairDto, UpdateRepairDto } from './repairs.dto';
import { RepairsService } from './repairs.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('repairs')
@UseGuards(AccessTokenGuard)
export class RepairsController {
  constructor(@Inject(RepairsService) private readonly repairs: RepairsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) { return this.repairs.list(request.user.sub); }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateRepairDto) { return this.repairs.create(request.user.sub, dto); }

  @Patch(':repairId')
  update(@Req() request: AuthenticatedRequest, @Param('repairId') repairId: string, @Body() dto: UpdateRepairDto) { return this.repairs.update(request.user.sub, repairId, dto); }

  @Delete(':repairId')
  remove(@Req() request: AuthenticatedRequest, @Param('repairId') repairId: string) { return this.repairs.remove(request.user.sub, repairId); }
}
