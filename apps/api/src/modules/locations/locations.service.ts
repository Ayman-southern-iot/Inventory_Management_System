import { Inject, Injectable } from '@nestjs/common';
import type {
  Compartment,
  CreateCompartmentInput,
  CreateZoneInput,
  UpdateCompartmentInput,
  UpdateZoneInput,
  Zone,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
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
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive: boolean): Promise<Zone[]> {
    return this.repo.listZones(includeInactive);
  }

  async createZone(input: CreateZoneInput, context: AuditContext): Promise<Zone> {
    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insertZone(input.name, tx);
        // Audit inside the transaction: a successful zone create cannot lack its audit row.
        await this.audit.record(
          {
            action: 'zone.create',
            entityType: 'zone',
            entityId: newId,
            entityRef: input.name,
            summary: `Created zone ${input.name}`,
            metadata: { name: input.name },
          },
          { ...context, actorName: context.actorName ?? input.name },
          tx,
        );
        return newId;
      });
      return await this.requireZone(id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A zone with that name already exists');
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
            { ...context, actorName: context.actorName ?? existing.name },
            tx,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A zone with that name already exists');
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

    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insertCompartment(input.zoneId, input.code, tx);
        // Audit inside the transaction: a successful compartment create cannot lack its audit
        // row. The zone's name provides a human reference in the summary.
        await this.audit.record(
          {
            action: 'compartment.create',
            entityType: 'compartment',
            entityId: newId,
            entityRef: `${zone.name}/${input.code}`,
            summary: `Created compartment ${zone.name}/${input.code}`,
            metadata: { zoneId: input.zoneId, code: input.code },
          },
          { ...context, actorName: context.actorName ?? zone.name },
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
            { ...context, actorName: context.actorName ?? existing.code },
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
