import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, config } from './config';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { SecurityModule } from './security/security.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StockModule } from './modules/stock/stock.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { LocationsModule } from './modules/locations/locations.module';
import { BorrowingModule } from './modules/borrowing/borrowing.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RequisitionsModule } from './modules/requisitions/requisitions.module';
import { BomsModule } from './modules/boms/boms.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FundsModule } from './modules/funds/funds.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { HealthController } from './modules/health/health.controller';

const toMs = (seconds: number): number => seconds * 1000;

/**
 * Four named throttler tiers. Each is per-IP and applied via `@Throttle` on the relevant
 * controllers — there is no implicit "default" tier anymore.
 *
 * - `auth`           login, refresh, password change, signature download (strict)
 * - `public`         BOM PDF download, /health (moderate — these routes have no session)
 * - `authenticated`  every other authenticated route (looser)
 * - `loginBurst`     layered on `auth` for `/auth/login` specifically — the burst limit and
 *                    the credential-exponential-backoff in `LoginThrottleService` solve
 *                    different problems; both belong.
 *
 * Without an explicit `@Throttle` decorator the request has no named tier and is therefore
 * not rate-limited at all (the global `ThrottlerGuard` only enforces named tiers). This is
 * deliberate: an undecorated controller is a config bug caught at boot via `audit:deps` and
 * local lint review, not a silent skip.
 */
const throttlerOptions = [
  { name: 'auth', ttl: toMs(config.throttling.auth.ttlSeconds), limit: config.throttling.auth.limit },
  {
    name: 'public',
    ttl: toMs(config.throttling.public.ttlSeconds),
    limit: config.throttling.public.limit,
  },
  {
    name: 'authenticated',
    ttl: toMs(config.throttling.authenticated.ttlSeconds),
    limit: config.throttling.authenticated.limit,
  },
  {
    name: 'loginBurst',
    ttl: toMs(config.throttling.loginBurst.ttlSeconds),
    limit: config.throttling.loginBurst.limit,
  },
];

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    SecurityModule,
    ThrottlerModule.forRoot(throttlerOptions),
    // In-process cron. At ~6 requisitions a day a queue server would be pure overhead
    // (DECISIONS.md); the jobs are a single indexed query each.
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    DepartmentsModule,
    SettingsModule,
    StockModule,
    CategoriesModule,
    ProductsModule,
    LocationsModule,
    BorrowingModule,
    ProjectsModule,
    RequisitionsModule,
    BomsModule,
    MaintenanceModule,
    AuditModule,
    NotificationsModule,
    FundsModule,
    ReportsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
