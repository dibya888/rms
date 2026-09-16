import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ThemePreference } from '@prisma/client';

export class RegisterDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username may only contain letters, numbers, dots, underscores, and hyphens' })
  username!: string;

  @IsString()
  @MinLength(7)
  phone!: string;

  @IsString()
  @MinLength(10)
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[0-9]/, { message: 'password must contain a digit' })
  @Matches(/[^A-Za-z0-9]/, { message: 'password must contain a special character' })
  password!: string;

  @IsString()
  confirmPassword!: string;
}

export class LoginDto {
  // Accepts either the account's email address or its username — the
  // frontend labels this field "Email or username" on both the owner and
  // admin login forms. Kept loose (@IsString, not @IsEmail) since it may
  // be either.
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResendActivationDto {
  // Same identifier the login form takes (email or username) — the login
  // screen's own "resend verification" link reuses whatever the person
  // just typed there, which may not be an email address.
  @IsString()
  @MinLength(1)
  identifier!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  token!: string;

  @IsString()
  @MinLength(10)
  @Matches(/[A-Z]/)
  @Matches(/[a-z]/)
  @Matches(/[0-9]/)
  @Matches(/[^A-Za-z0-9]/)
  password!: string;

  @IsString()
  confirmPassword!: string;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @Matches(/^(LIGHT|DARK)$/)
  theme?: ThemePreference;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currencyCode must be a 3-letter currency code' })
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(12h|24h)$/)
  timeFormat?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username may only contain letters, numbers, dots, underscores, and hyphens' })
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  phone?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[0-9]/, { message: 'password must contain a digit' })
  @Matches(/[^A-Za-z0-9]/, { message: 'password must contain a special character' })
  newPassword!: string;

  @IsString()
  confirmNewPassword!: string;
}
