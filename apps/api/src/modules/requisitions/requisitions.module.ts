import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { ApprovalDeadlineJob } from './approval-deadline.job';
import { DelegationsService } from './delegations.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsRepository } from './requisitions.repository';
import { RequisitionsService } from './requisitions.service';

/**
 * Imports SettingsModule for the expense threshold and approver counts — read once at submit
 * and then frozen onto the requisition, never consulted again for that request.
 */
@Module({
  imports: [SettingsModule, AuditModule, NotificationsModule, UsersModule],
  controllers: [RequisitionsController],
  providers: [RequisitionsService, RequisitionsRepository, DelegationsService, ApprovalDeadlineJob],
  exports: [RequisitionsService, RequisitionsRepository],
})
export class RequisitionsModule {}
