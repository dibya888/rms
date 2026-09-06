import { Body, Controller, Get, Inject, Param, Post, Req, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BadRequestException, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateLeaseDto, CreateTenantDto, MoveOutDto, SettleDto } from './tenancy.dto';
import { TenancyService } from './tenancy.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('tenants')
@UseGuards(AccessTokenGuard)
export class TenancyController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) { return this.tenancy.listTenants(request.user.sub); }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateTenantDto) { return this.tenancy.createTenant(request.user.sub, dto); }

  @Get('leases')
  leases(@Req() request: AuthenticatedRequest) { return this.tenancy.listLeases(request.user.sub); }

  @Post('leases')
  createLease(@Req() request: AuthenticatedRequest, @Body() dto: CreateLeaseDto) { return this.tenancy.createLease(request.user.sub, dto); }

  @Post(':tenantId/move-out')
  moveOut(@Req() request: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Body() dto: MoveOutDto) { return this.tenancy.moveOut(request.user.sub, tenantId, dto); }

  @Get(':tenantId/settlement-preview')
  preview(@Req() request: AuthenticatedRequest, @Param('tenantId') tenantId: string) { return this.tenancy.previewSettlement(request.user.sub, tenantId); }

  @Post('settlements/:settlementId/settle')
  settle(@Req() request: AuthenticatedRequest, @Param('settlementId') settlementId: string, @Body() dto: SettleDto) { return this.tenancy.settle(request.user.sub, settlementId, dto); }

  @Post(':tenantId/id-document')
  @UseInterceptors(FileInterceptor('document', { limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_request, file, callback) => { if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) return callback(new BadRequestException('only PDF, JPEG, and PNG documents are allowed'), false); callback(null, true); } }))
  uploadDocument(@Req() request: AuthenticatedRequest, @Param('tenantId') tenantId: string, @UploadedFile() file?: Express.Multer.File) { if (!file) throw new BadRequestException('document file is required'); return this.tenancy.uploadIdDocument(request.user.sub, tenantId, file); }
}
