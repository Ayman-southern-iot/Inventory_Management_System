import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config';
import { DatabaseModule } from './database/database.module';
import { SecurityModule } from './security/security.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthController } from './modules/health/health.controller';

/** Blanket ceiling. Endpoints that need something stricter declare it with `@Throttle`. */
const GLOBAL_RATE_LIMIT = [{ name: 'default', ttl: 60_000, limit: 300 }];

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SecurityModule,
    ThrottlerModule.forRoot(GLOBAL_RATE_LIMIT),
    AuthModule,
    UsersModule,
    DepartmentsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
