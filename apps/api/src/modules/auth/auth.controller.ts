import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResponse,
  type RefreshInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { UsersService } from '../users/users.service';
import { AuthService, type LoginContext } from './auth.service';
import { AllowPendingPasswordChange, CurrentUser, Public } from './auth.decorators';
import type { RequestUser } from './request-user';

/** Coarse per-IP ceiling in front of the per-account throttle in LoginThrottleService. */
const LOGIN_BURST_LIMIT = { default: { limit: 10, ttl: 60_000 } };

function contextOf(request: Request): LoginContext {
  return {
    ip: request.ip ?? 'unknown',
    userAgent: request.headers['user-agent'] ?? null,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Throttle(LOGIN_BURST_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(zodPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
  ): Promise<LoginResponse> {
    return this.auth.login(body, contextOf(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(zodPipe(refreshSchema)) body: RefreshInput,
    @Req() request: Request,
  ): Promise<LoginResponse> {
    return this.auth.refresh(body.refreshToken, contextOf(request));
  }

  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: RequestUser,
    // Optional: a client that has lost its refresh token can still end every session.
    @Body(zodPipe(refreshSchema.partial())) body: Partial<RefreshInput>,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken, user.id);
  }

  @AllowPendingPasswordChange()
  @Get('me')
  async me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.me(user.id);
  }

  /** Returns a fresh session so the caller is not signed out by their own password change. */
  @AllowPendingPasswordChange()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body(zodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() request: Request,
  ): Promise<LoginResponse> {
    // The actor is req.user, never a body field — a client-supplied id here would let anyone
    // change anyone's password (rules/20-backend.md).
    return this.auth.changePassword(user.id, body, contextOf(request));
  }
}
