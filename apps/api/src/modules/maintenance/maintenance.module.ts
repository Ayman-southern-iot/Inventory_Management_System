import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RetentionJob } from './retention.job';

/** Scheduled housekeeping. Closes gap G-01 from the Phase 00 handoff. */
@Module({
  imports: [AuthModule],
  providers: [RetentionJob],
  exports: [RetentionJob],
})
export class MaintenanceModule {}
