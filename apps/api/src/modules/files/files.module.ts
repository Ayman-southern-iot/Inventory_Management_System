import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { PendingUploadSweepJob } from './pending-upload-sweep.job';
import { SupportingDocumentUploadController } from './uploads.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Phase 05 task 5.1 — the one way bytes enter this system.
 *
 * Exports the service, not the storage primitive: a caller gets "store this, record who uploaded
 * it, give me back a row", never a raw path they could hand to `readFile`.
 *
 * The `SupportingDocumentUploadController` lives here because its only job is to write a
 * `stored_files` row in the orphan state (pre-draft attach). The parent claim lives in the
 * requisitions module — `RequisitionsService.createDraft` reads `pendingSupportingDocumentId`
 * from the create body and claims the file in the same transaction.
 *
 * `PendingUploadSweepJob` deletes orphan SUPPORTING_DOCUMENT rows older than 24h so a user
 * who abandons the form does not accumulate bytes indefinitely.
 */
@Module({
  imports: [AuditModule],
  providers: [FileStorageService, FilesRepository, FilesService, PendingUploadSweepJob],
  controllers: [SupportingDocumentUploadController],
  exports: [FilesService],
})
export class FilesModule {}
