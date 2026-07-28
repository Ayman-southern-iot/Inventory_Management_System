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
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
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
    @CurrentUser() actor: RequestUser,
  ): Promise<Setting> {
    return this.settings.set(body.key, body.value, actor.id);
  }

  @Get('approver-slots')
  async listSlots(): Promise<ApproverSlot[]> {
    return this.approverSlots.list();
  }

  @Put('approver-slots')
  async setSlot(
    @Body(zodPipe(setApproverSlotSchema)) body: SetApproverSlotInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<ApproverSlot[]> {
    return this.approverSlots.set(body, actor.id);
  }
}
