import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApproverSlotsService } from './approver-slots.service';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [SettingsRepository, SettingsService, ApproverSlotsService],
  exports: [SettingsService, ApproverSlotsService],
})
export class SettingsModule {}
