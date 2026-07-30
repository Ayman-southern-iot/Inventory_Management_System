import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  Role,
  setApproverSlotSchema,
  updateSettingSchema,
  type ApproverSlot,
  type Setting,
  type SetApproverSlotInput,
  type UpdateSettingInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.decorators';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { ApproverSlotsService } from './approver-slots.service';
import { SettingsService } from './settings.service';

@Roles(Role.ADMIN)
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly approverSlots: ApproverSlotsService,
  ) {}

  @Get()
  async list(): Promise<Setting[]> {
    return this.settings.list();
  }

  @Put()
  async update(
    @Body(zodPipe(updateSettingSchema)) body: UpdateSettingInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Setting> {
    return this.settings.set(body.key, body.value, ctx);
  }

  @Get('approver-slots')
  async listSlots(): Promise<ApproverSlot[]> {
    return this.approverSlots.list();
  }

  @Put('approver-slots')
  async setSlot(
    @Body(zodPipe(setApproverSlotSchema)) body: SetApproverSlotInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ApproverSlot[]> {
    return this.approverSlots.set(body, ctx);
  }
}
