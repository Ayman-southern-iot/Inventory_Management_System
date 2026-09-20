import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  Role,
  createCompartmentSchema,
  createRoomSchema,
  createZoneSchema,
  queryBoolean,
  updateCompartmentSchema,
  updateRoomSchema,
  updateZoneSchema,
  type Compartment,
  type CreateCompartmentInput,
  type CreateRoomInput,
  type CreateZoneInput,
  type Room,
  type UpdateCompartmentInput,
  type UpdateRoomInput,
  type UpdateZoneInput,
  type Zone,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { LocationsService } from './locations.service';

const listQuerySchema = z.object({
  // `queryBoolean`, never `z.coerce.boolean()`: this arrives as query-string text, and coercion
  // reads every non-empty string — `"false"` included — as `true`, so `?includeInactive=false`
  // would list the retired zones it was asked to hide.
  includeInactive: queryBoolean(false),
});

@AuthenticatedThrottle
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

  /**
   * The full tree, Room → Zone → Compartment. The Locations page renders this; the pickers use
   * `GET /locations` above, which stays a flat zone list so an existing caller is unaffected.
   */
  @Get('rooms')
  async listRooms(
    @Query(zodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Room[]> {
    return this.locations.listRooms(query.includeInactive);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post('rooms')
  async createRoom(
    @Body(zodPipe(createRoomSchema)) body: CreateRoomInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Room> {
    return this.locations.createRoom(body, ctx);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch('rooms/:id')
  async updateRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRoomSchema)) body: UpdateRoomInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Room> {
    return this.locations.updateRoom(id, body, ctx);
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
