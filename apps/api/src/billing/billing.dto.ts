import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class GenerateBillsDto {
  @IsDateString()
  billMonth!: string;
}

export class RecordPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsDateString()
  paidOn!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  electricity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  water?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  gas?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  otherBills?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fine?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDefaultsDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  electricity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  water!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  gas!: number;

  @IsInt()
  @Min(1)
  @Max(28)
  dueDay!: number;
}
