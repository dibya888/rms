import { Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, ThemePreferenceDto } from './auth.dto';
import { AccessTokenGuard } from './access-token.guard';

const refreshCookie = 'rms_refresh';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('csrf')
  csrf(@Req() request: Request) { return { csrfToken: request.cookies?.rms_csrf }; }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const tokens = await this.auth.login(dto);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Get('activate')
  async activate(@Query('token') token: string) { return this.auth.activate(token); }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = dto.refreshToken ?? request.cookies?.[refreshCookie];
    const tokens = await this.auth.refresh(token);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto); }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto); }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[refreshCookie]);
    response.clearCookie(refreshCookie, this.cookieOptions());
    return { status: 'ok' };
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() request: Request & { user?: { sub: string; email: string; firstName?: string } }) {
    return { user: request.user };
  }

  @Get('preferences')
  @UseGuards(AccessTokenGuard)
  preferences(@Req() request: Request & { user?: { sub: string } }) { return this.auth.getPreferences(request.user!.sub); }

  @Post('preferences')
  @UseGuards(AccessTokenGuard)
  updatePreferences(@Req() request: Request & { user?: { sub: string } }, @Body() dto: ThemePreferenceDto) { return this.auth.updatePreferences(request.user!.sub, dto.theme); }

  private setRefreshCookie(response: Response, token: string) {
    response.cookie(refreshCookie, token, { ...this.cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  }

  private cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/auth' };
  }
}
