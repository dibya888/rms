import { IsEnum, IsInt, IsObject, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { PropertyType, UnitStatus, UnitType } from '@prisma/client';

export class CreatePropertyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsString()
  @MinLength(7)
  phone!: string;

  @IsEnum(PropertyType)
  propertyType!: PropertyType;
}

export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  address?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  phone?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;
}

export class CreateUnitDto {
  @IsString()
  @MinLength(1)
  unitNo!: string;

  @IsEnum(UnitType)
  unitType!: UnitType;

  @IsPositive()
  rent!: number;

  @IsObject()
  unitAttributes!: Record<string, unknown>;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  unitNo?: string;

  @IsOptional()
  @IsPositive()
  rent?: number;

  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;

  @IsOptional()
  @IsObject()
  unitAttributes?: Record<string, unknown>;
}

export class PropertyIdDto {
  @IsString()
  propertyId!: string;
}
