import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  Role,
  createCompartmentSchema,
  createZoneSchema,
  updateCompartmentSchema,
  updateZoneSchema,
  type Compartment,
  type CreateCompartmentInput,
  type CreateZoneInput,
  type UpdateCompartmentInput,
  type UpdateZoneInput,
  type Zone,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.decorators';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { LocationsService } from './locations.service';

const listQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
});

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  /** Readable by any authenticated user — the borrow and move forms need the location list. */
  @Get()
  async list(
    @Query(zodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Zone[]> {
    return this.locations.list(query.includeInactive);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('zones')
  async createZone(
    @Body(zodPipe(createZoneSchema)) body: CreateZoneInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Zone> {
    return this.locations.createZone(body, ctx);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch('zones/:id')
  async updateZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateZoneSchema)) body: UpdateZoneInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Zone> {
    return this.locations.updateZone(id, body, ctx);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('compartments')
  async createCompartment(
    @Body(zodPipe(createCompartmentSchema)) body: CreateCompartmentInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Compartment> {
    return this.locations.createCompartment(body, ctx);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch('compartments/:id')
  async updateCompartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCompartmentSchema)) body: UpdateCompartmentInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Compartment> {
    return this.locations.updateCompartment(id, body, ctx);
  }
}
