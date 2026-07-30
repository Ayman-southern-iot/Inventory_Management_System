import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { RetentionJob } from './retention.job';

/** Scheduled housekeeping. Closes gap G-01 from the Phase 00 handoff, plus the audit purge. */
@Module({
  imports: [AuthModule, AuditModule, SettingsModule],
  providers: [RetentionJob],
  exports: [RetentionJob],
})
export class MaintenanceModule {}
