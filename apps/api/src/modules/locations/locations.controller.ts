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
  async createZone(@Body(zodPipe(createZoneSchema)) body: CreateZoneInput): Promise<Zone> {
    return this.locations.createZone(body);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch('zones/:id')
  async updateZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateZoneSchema)) body: UpdateZoneInput,
  ): Promise<Zone> {
    return this.locations.updateZone(id, body);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('compartments')
  async createCompartment(
    @Body(zodPipe(createCompartmentSchema)) body: CreateCompartmentInput,
  ): Promise<Compartment> {
    return this.locations.createCompartment(body);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch('compartments/:id')
  async updateCompartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCompartmentSchema)) body: UpdateCompartmentInput,
  ): Promise<Compartment> {
    return this.locations.updateCompartment(id, body);
  }
}
