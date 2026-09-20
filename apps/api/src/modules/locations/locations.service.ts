import { Inject, Injectable } from '@nestjs/common';
import type {
  Compartment,
  CreateCompartmentInput,
  CreateRoomInput,
  CreateZoneInput,
  Room,
  UpdateCompartmentInput,
  UpdateRoomInput,
  UpdateZoneInput,
  Zone,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
import { CONFIG, type AppConfig } from '../../config';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { isUniqueViolation } from '../../common/pg-errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { diffSafeFields } from '../audit/audit-sanitizer';
import { LocationsRepository } from './locations.repository';

@Injectable()
export class LocationsService {
  constructor(
    private readonly repo: LocationsRepository,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive: boolean): Promise<Zone[]> {
    return this.repo.listZones(includeInactive);
  }

  /** The full tree, Room → Zone → Compartment. What the Locations page renders. */
  async listRooms(includeInactive: boolean): Promise<Room[]> {
    return this.repo.listRooms(includeInactive);
  }

  async createRoom(input: CreateRoomInput, context: AuditContext): Promise<Room> {
    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insertRoom(input.name, tx);
        await this.audit.record(
          {
            action: 'room.create',
            entityType: 'room',
            entityId: newId,
            entityRef: input.name,
            summary: `Created room ${input.name}`,
            metadata: { name: input.name },
          },
          context,
          tx,
        );
        return newId;
      });
      return await this.requireRoom(id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A room with that name already exists');
      throw error;
    }
  }

  async updateRoom(id: string, input: UpdateRoomInput, context: AuditContext): Promise<Room> {
    const existing = await this.repo.findRoom(id);
    if (!existing) throw new NotFoundError('Room');

    /**
     * Same rule as a zone, one level up: deactivating a room would hide every zone and
     * compartment under it, so stock inside would vanish from the UI while still sitting on a
     * shelf. Renaming is always allowed — and deliberately does **not** rewrite the Storage IDs
     * underneath, which are immutable once printed (migration 0034).
     */
    if (input.isActive === false) {
      const held = await this.repo.countStockInRoom(id);
      if (held > 0) {
        throw new ConflictError(
          `${held} compartment(s) in this room still hold stock. Move or issue it first.`,
        );
      }
    }

    try {
      await this.db.transaction().execute(async (tx) => {
        await this.repo.updateRoom(id, { name: input.name, isActive: input.isActive }, tx);
        const changes = diffSafeFields(
          { name: existing.name, isActive: existing.is_active },
          {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
          ['name', 'isActive'],
        );
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: 'room.update',
              entityType: 'room',
              entityId: id,
              entityRef: existing.name,
              summary: `Updated room ${existing.name}`,
              metadata: { changes },
            },
            context,
            tx,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A room with that name already exists');
      throw error;
    }

    return this.requireRoom(id);
  }

  async createZone(input: CreateZoneInput, context: AuditContext): Promise<Zone> {
    const room = await this.repo.findRoom(input.roomId);
    if (!room) throw new NotFoundError('Room');

    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insertZone(input.name, input.roomId, tx);
        // Audit inside the transaction: a successful zone create cannot lack its audit row.
        await this.audit.record(
          {
            action: 'zone.create',
            entityType: 'zone',
            entityId: newId,
            entityRef: `${room.name}/${input.name}`,
            summary: `Created zone ${input.name} in ${room.name}`,
            metadata: { name: input.name, roomId: input.roomId },
          },
          context,
          tx,
        );
        return newId;
      });
      return await this.requireZone(id);
    } catch (error) {
      // Per-room now, not global: the same zone name in a different room is legal.
      if (isUniqueViolation(error)) {
        throw new ConflictError(`A zone called "${input.name}" already exists in ${room.name}`);
      }
      throw error;
    }
  }

  async updateZone(
    id: string,
    input: UpdateZoneInput,
    context: AuditContext,
  ): Promise<Zone> {
    const existing = await this.repo.findZone(id);
    if (!existing) throw new NotFoundError('Zone');

    // Deactivating a zone hides every compartment under it, so stock inside would vanish from
    // the UI while still existing in the database — the exact divergence this system exists
    // to prevent.
    if (input.isActive === false) {
      const held = await this.repo.countStockInZone(id);
      if (held > 0) {
        throw new ConflictError(
          `${held} compartment(s) in this zone still hold stock. Move or issue it first.`,
        );
      }
    }

    try {
      await this.db.transaction().execute(async (tx) => {
        await this.repo.updateZone(id, { name: input.name, isActive: input.isActive }, tx);
        const changes = diffSafeFields(
          { name: existing.name, isActive: existing.is_active },
          {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
          ['name', 'isActive'],
        );
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: 'zone.update',
              entityType: 'zone',
              entityId: id,
              entityRef: existing.name,
              summary: `Updated zone ${existing.name}`,
              metadata: { changes },
            },
            context,
            tx,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A zone with that name already exists in this room');
      }
      throw error;
    }

    return this.requireZone(id);
  }

  async createCompartment(
    input: CreateCompartmentInput,
    context: AuditContext,
  ): Promise<Compartment> {
    const zone = await this.repo.findZone(input.zoneId);
    if (!zone) throw new NotFoundError('Zone');
    // The room name is a component of the Storage ID, snapshotted at creation.
    const room = await this.repo.findRoom(zone.room_id);
    if (!room) throw new NotFoundError('Room');

    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const created = await this.repo.insertCompartment(
          input.zoneId,
          input.code,
          this.config.storageId,
          tx,
        );
        const newId = created.id;
        // Audit inside the transaction: a successful compartment create cannot lack its audit
        // row. The zone's name provides a human reference in the summary.
        await this.audit.record(
          {
            action: 'compartment.create',
            entityType: 'compartment',
            entityId: newId,
            entityRef: `${zone.name}/${input.code}`,
            summary: `Created compartment ${zone.name}/${input.code}`,
            metadata: { zoneId: input.zoneId, code: input.code, storageId: created.storageId },
          },
          context,
          tx,
        );
        return newId;
      });
      return await this.requireCompartment(input.zoneId, id);
    } catch (error) {
      // The unique index on (zone_id, lower(btrim(code))) is the guarantee — a pre-check
      // SELECT would still let two concurrent creates through.
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Compartment "${input.code}" already exists in ${zone.name}`);
      }
      throw error;
    }
  }

  async updateCompartment(
    id: string,
    input: UpdateCompartmentInput,
    context: AuditContext,
  ): Promise<Compartment> {
    const existing = await this.repo.findCompartment(id);
    if (!existing) throw new NotFoundError('Compartment');

    if (input.isActive === false) {
      const held = await this.repo.countStockIn(id);
      if (held > 0) {
        throw new ConflictError(
          `This compartment still holds ${held} product(s). Move or issue the stock first.`,
        );
      }
    }

    try {
      await this.db.transaction().execute(async (tx) => {
        await this.repo.updateCompartment(
          id,
          { code: input.code, isActive: input.isActive },
          tx,
        );
        const changes = diffSafeFields(
          { code: existing.code, isActive: existing.is_active },
          {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
          ['code', 'isActive'],
        );
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: 'compartment.update',
              entityType: 'compartment',
              entityId: id,
              entityRef: `${existing.zone_id}/${existing.code}`,
              summary: `Updated compartment ${existing.code}`,
              metadata: { changes },
            },
            context,
            tx,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Another compartment in this zone already uses that code');
      }
      throw error;
    }

    return this.requireCompartment(existing.zone_id, id);
  }

  private async requireRoom(id: string): Promise<Room> {
    const rooms = await this.repo.listRooms(true);
    const room = rooms.find((r) => r.id === id);
    if (!room) throw new NotFoundError('Room');
    return room;
  }

  private async requireZone(id: string): Promise<Zone> {
    const zones = await this.repo.listZones(true);
    const zone = zones.find((z) => z.id === id);
    if (!zone) throw new NotFoundError('Zone');
    return zone;
  }

  private async requireCompartment(zoneId: string, compartmentId: string): Promise<Compartment> {
    const zone = await this.requireZone(zoneId);
    const compartment = zone.compartments.find((c) => c.id === compartmentId);
    if (!compartment) throw new NotFoundError('Compartment');
    return compartment;
  }
}
