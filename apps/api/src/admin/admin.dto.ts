import { IsEnum, IsString, IsUUID, MinLength } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}

export class UpdateUserRoleDto {
  @IsUUID()
  roleId!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}
