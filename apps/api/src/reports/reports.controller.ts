import { BadRequestException, Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { ReportFilterDto } from './reports.dto';
import { ReportsService } from './reports.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('reports')
@UseGuards(AccessTokenGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('transactions')
  transactions(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.transactions(request.user.sub, filters); }

  @Get('summary')
  summary(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.summary(request.user.sub, filters); }

  @Get('utilities')
  utilities(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.utilities(request.user.sub, filters); }

  @Get('outstanding')
  outstanding(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.outstanding(request.user.sub, filters); }

  @Get('income/property')
  propertyIncome(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.groupedIncome(request.user.sub, filters, 'property'); }

  @Get('income/unit')
  unitIncome(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.groupedIncome(request.user.sub, filters, 'unit'); }

  @Get('income/tenant')
  tenantIncome(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.groupedIncome(request.user.sub, filters, 'tenant'); }

  @Get('income/monthly')
  monthlyIncome(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.groupedIncome(request.user.sub, filters, 'month'); }

  @Get('income/yearly')
  yearlyIncome(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.groupedIncome(request.user.sub, filters, 'year'); }

  @Get('repairs')
  repairs(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto) { return this.reports.repairs(request.user.sub, filters); }

  @Get('income/:group/export/:format')
  async exportIncome(@Req() request: AuthenticatedRequest, @Param('group') group: string, @Param('format') format: string, @Query() filters: ReportFilterDto, @Res() response: Response) {
    if (!['property', 'unit', 'tenant', 'month', 'year'].includes(group) || !['pdf', 'xlsx'].includes(format)) throw new BadRequestException('invalid income report export');
    const exported = await this.reports.exportReport(request.user.sub, `income/${group}`, format as 'pdf' | 'xlsx', filters);
    response.setHeader('Content-Type', exported.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="rms-income-${group}.${format}"`);
    response.send(exported.buffer);
  }

  @Get(':report/export/:format')
  async exportReport(@Req() request: AuthenticatedRequest, @Param('report') report: string, @Param('format') format: string, @Query() filters: ReportFilterDto, @Res() response: Response) {
    if (!['pdf', 'xlsx'].includes(format)) throw new BadRequestException('format must be pdf or xlsx');
    const exported = await this.reports.exportReport(request.user.sub, report, format as 'pdf' | 'xlsx', filters);
    response.setHeader('Content-Type', exported.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="rms-${report.replaceAll('/', '-')}.${format}"`);
    response.send(exported.buffer);
  }

  @Get('transactions.xlsx')
  async excel(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto, @Res() response: Response) { response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); response.setHeader('Content-Disposition', 'attachment; filename="rms-transactions.xlsx"'); response.send(await this.reports.excel(request.user.sub, filters)); }

  @Get('transactions.pdf')
  async pdf(@Req() request: AuthenticatedRequest, @Query() filters: ReportFilterDto, @Res() response: Response) { response.setHeader('Content-Type', 'application/pdf'); response.setHeader('Content-Disposition', 'attachment; filename="rms-transactions.pdf"'); response.send(await this.reports.pdf(request.user.sub, filters)); }
}
