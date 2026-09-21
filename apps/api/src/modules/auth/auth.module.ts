import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleService } from './login-throttle.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RolesGuard } from './roles.guard';

@Module({
  // Secrets are passed per-call in AuthService because access and refresh use different keys;
  // registering one here would make it too easy to sign a refresh token with the access key.
  // ApiKeysModule, because the global JwtAuthGuard authenticates keys as well as sessions.
  // The dependency runs this way only: ApiKeysModule must never import AuthModule.
  imports: [JwtModule.register({}), UsersModule, AuditModule, ApiKeysModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginThrottleService,
    RefreshTokenRepository,
    // Authenticated by default. `@Public()` is the only way out.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [AuthService, RefreshTokenRepository, LoginThrottleService],
})
export class AuthModule {}
