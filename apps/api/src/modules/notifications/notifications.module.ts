import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/**
 * Phase 06 — in-app notifications. The service is exported so every domain module can raise an
 * event inside its own transaction; the repository is not, so nothing outside this module can
 * write a row that skipped the copy templates.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
