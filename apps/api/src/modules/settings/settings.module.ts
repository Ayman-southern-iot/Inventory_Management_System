import { Module } from '@nestjs/common';
import { ApproverSlotsService } from './approver-slots.service';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsRepository, SettingsService, ApproverSlotsService],
  exports: [SettingsService, ApproverSlotsService],
})
export class SettingsModule {}
