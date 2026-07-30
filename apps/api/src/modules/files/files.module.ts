import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';

/**
 * Phase 05 task 5.1 — the one way bytes enter this system.
 *
 * Exports the service, not the storage primitive: a caller gets "store this, record who uploaded
 * it, give me back a row", never a raw path they could hand to `readFile`.
 */
@Module({
  providers: [FileStorageService, FilesRepository, FilesService],
  exports: [FilesService],
})
export class FilesModule {}
