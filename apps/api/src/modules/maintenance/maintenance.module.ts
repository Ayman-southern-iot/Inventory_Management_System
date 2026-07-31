import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RetentionJob } from './retention.job';
import { MonitoringJob } from './monitoring.job';
import { SystemHealthService } from './system-health.service';

/** Scheduled housekeeping. Closes gap G-01 from the Phase 00 handoff, plus the audit purge. */
@Module({
  imports: [AuthModule, AuditModule, SettingsModule, NotificationsModule],
  providers: [RetentionJob, MonitoringJob, SystemHealthService],
  exports: [RetentionJob, MonitoringJob, SystemHealthService],
})
export class MaintenanceModule {}
