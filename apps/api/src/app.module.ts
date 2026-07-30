import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config';
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
import { RequisitionsModule } from './modules/requisitions/requisitions.module';
import { BomsModule } from './modules/boms/boms.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthController } from './modules/health/health.controller';

/** Blanket ceiling. Endpoints that need something stricter declare it with `@Throttle`. */
const GLOBAL_RATE_LIMIT = [{ name: 'default', ttl: 60_000, limit: 300 }];

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    SecurityModule,
    ThrottlerModule.forRoot(GLOBAL_RATE_LIMIT),
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
    RequisitionsModule,
    BomsModule,
    MaintenanceModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
