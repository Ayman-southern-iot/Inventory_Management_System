import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';
import { FundsModule } from '../funds/funds.module';
import { ApprovalDeadlineJob } from './approval-deadline.job';
import { DelegationsService } from './delegations.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsRepository } from './requisitions.repository';
import { RequisitionsService } from './requisitions.service';
import { RequisitionDocumentsController } from './requisition-documents.controller';
import { RequisitionDocumentsService } from './requisition-documents.service';

/**
 * Imports SettingsModule for the expense threshold and approver counts — read once at submit
 * and then frozen onto the requisition, never consulted again for that request.
 *
 * FilesModule is imported for `RequisitionDocumentsService` — the supporting document on a
 * requisition is bytes-in, bytes-out, with the file module owning the disk and the row and
 * this module owning the per-requisition authorisation.
 *
 * FundsModule is imported (forward-ref) for `FundsRepository`, which the submit / IM-approve /
 * final-approve transitions call to write the `funding_snapshots` rows. The pair is forwardRef
 * because `FundsModule` already imports `RequisitionsModule` for `RequisitionsRepository`.
 */
@Module({
  imports: [
    SettingsModule,
    AuditModule,
    NotificationsModule,
    UsersModule,
    FilesModule,
    forwardRef(() => FundsModule),
  ],
  controllers: [RequisitionsController, RequisitionDocumentsController],
  providers: [
    RequisitionsService,
    RequisitionsRepository,
    DelegationsService,
    ApprovalDeadlineJob,
    RequisitionDocumentsService,
  ],
  exports: [RequisitionsService, RequisitionsRepository],
})
export class RequisitionsModule {}
