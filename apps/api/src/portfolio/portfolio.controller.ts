import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreatePropertyDto, CreateUnitDto, UpdatePropertyDto, UpdateUnitDto } from './portfolio.dto';
import { PortfolioService } from './portfolio.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('portfolio')
@UseGuards(AccessTokenGuard)
export class PortfolioController {
  constructor(@Inject(PortfolioService) private readonly portfolio: PortfolioService) {}

  @Get('properties')
  listProperties(@Req() request: AuthenticatedRequest) { return this.portfolio.listProperties(request.user.sub); }

  @Post('properties')
  createProperty(@Req() request: AuthenticatedRequest, @Body() dto: CreatePropertyDto) { return this.portfolio.createProperty(request.user.sub, dto); }

  @Patch('properties/:propertyId')
  updateProperty(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string, @Body() dto: UpdatePropertyDto) { return this.portfolio.updateProperty(request.user.sub, propertyId, dto); }

  @Delete('properties/:propertyId')
  deleteProperty(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string) { return this.portfolio.deleteProperty(request.user.sub, propertyId); }

  @Get('properties/:propertyId/units')
  listUnits(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string) { return this.portfolio.listUnits(request.user.sub, propertyId); }

  @Post('properties/:propertyId/units')
  createUnit(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string, @Body() dto: CreateUnitDto) { return this.portfolio.createUnit(request.user.sub, propertyId, dto); }

  @Patch('units/:unitId')
  updateUnit(@Req() request: AuthenticatedRequest, @Param('unitId') unitId: string, @Body() dto: UpdateUnitDto) { return this.portfolio.updateUnit(request.user.sub, unitId, dto); }

  @Delete('units/:unitId')
  deleteUnit(@Req() request: AuthenticatedRequest, @Param('unitId') unitId: string) { return this.portfolio.deleteUnit(request.user.sub, unitId); }
}
