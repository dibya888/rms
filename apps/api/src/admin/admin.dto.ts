import { Equals, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { UserStatus } from '@prisma/client';

const CLEAN_DATABASE_CONFIRMATION = 'DELETE ALL DATA';

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

export class CleanDatabaseDto {
  // Requires the admin to type an exact confirmation phrase so the
  // destructive action can never be triggered by an accidental request.
  @IsString()
  @Equals(CLEAN_DATABASE_CONFIRMATION, { message: `confirmation must equal "${CLEAN_DATABASE_CONFIRMATION}"` })
  confirmation!: string;

  // When provided, only this owner's business data is wiped. When omitted,
  // business data for every tenant/owner in the system is wiped.
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class DeleteUserDto {
  // Requires the admin to type the exact account email being deleted, so
  // this irreversible action can't be fired by an accidental click and the
  // admin has to actually look at which account they're removing.
  @IsEmail()
  confirmation!: string;
}

export class DeletePropertyDto {
  // Requires the admin to type the exact property name being deleted, so
  // this irreversible action can't be fired by an accidental click and the
  // admin has to actually look at which property they're removing. Checked
  // against the property's actual name in the controller (case-sensitive,
  // trimmed), since the expected value is dynamic per-property.
  @IsString()
  @MinLength(1)
  confirmation!: string;
}
