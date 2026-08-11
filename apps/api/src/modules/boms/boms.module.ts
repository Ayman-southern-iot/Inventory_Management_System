import { Module, forwardRef } from '@nestjs/common';
import { RequisitionsModule } from '../requisitions/requisitions.module';
import { FundsModule } from '../funds/funds.module';
import { SettingsModule } from '../settings/settings.module';
import { CommonModule } from '../../common/common.module';
import { PdfModule } from '../pdf/pdf.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';
import { BomsController } from './boms.controller';
import { BomsRepository } from './boms.repository';
import { BomsService } from './boms.service';

/**
 * The BOM module.
 *
 * Imports `RequisitionsModule` for the approval snapshot (freezing the chain into
 * `bom_requisitions.approval_snapshot`), `SettingsModule` for the over-budget tolerance
 * (OQ-05), `CommonModule` for the idempotency service on `POST /boms` and the render
 * endpoint, `PdfModule` (task 4.3) for the renderer + signed-URL signer, and `AuditModule`
 * (phase 06) so every BOM mutation writes a row to `audit_log` in the same transaction.
 *
 * `FundsModule` (forward-ref) is imported for `FundsRepository`, which the BOM-creation hook
 * uses to write the BOM stage snapshot. The forwardRef is needed because `FundsModule`
 * already imports `RequisitionsModule`.
 */
@Module({
  imports: [
    RequisitionsModule,
    forwardRef(() => FundsModule),
    SettingsModule,
    CommonModule,
    PdfModule,
    AuditModule,
    NotificationsModule,
    FilesModule,
  ],
  controllers: [BomsController],
  providers: [BomsService, BomsRepository],
  exports: [BomsService, BomsRepository],
})
export class BomsModule {}
