import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { BillingService } from './billing.service';
import { GenerateBillsDto, RecordPaymentDto, UpdateDefaultsDto } from './billing.dto';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('billing')
@UseGuards(AccessTokenGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get('bills')
  bills(@Req() request: AuthenticatedRequest) { return this.billing.listBills(request.user.sub); }

  @Post('generate')
  generate(@Req() request: AuthenticatedRequest, @Body() dto: GenerateBillsDto) { return this.billing.generateBills(request.user.sub, dto); }

  @Post('bills/:billId/payments')
  pay(@Req() request: AuthenticatedRequest, @Param('billId') billId: string, @Body() dto: RecordPaymentDto) { return this.billing.recordPayment(request.user.sub, billId, dto, request.user.sub); }

  @Post('bills/:billId/undo-latest-payment')
  undo(@Req() request: AuthenticatedRequest, @Param('billId') billId: string) { return this.billing.undoLatestPayment(request.user.sub, billId); }

  @Patch('defaults')
  updateDefaults(@Req() request: AuthenticatedRequest, @Body() values: UpdateDefaultsDto) { return this.billing.updateDefaults(request.user.sub, values); }
}
