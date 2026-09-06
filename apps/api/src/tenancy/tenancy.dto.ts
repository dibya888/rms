import { IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { SettlementResult } from '@prisma/client';

export class CreateTenantDto {
  @IsUUID()
  unitId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(7)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsDateString()
  moveInDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyRent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  securityDeposit!: number;

  @IsOptional()
  @IsDateString()
  depositDate?: string;

  @IsOptional()
  @IsString()
  depositNote?: string;
}

export class MoveOutDto {
  @IsDateString()
  moveOutDate!: string;

  @IsString()
  @MinLength(1)
  moveOutReason!: string;
}

export class SettleDto {
  @IsEnum(SettlementResult)
  result!: SettlementResult;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  refundAmount!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  payableAmount!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CreateLeaseDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  unitId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyRent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  securityDeposit!: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  depositDate?: string;

  @IsOptional()
  @IsString()
  depositNote?: string;
}
