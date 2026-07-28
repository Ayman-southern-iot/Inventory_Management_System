import { Injectable } from '@nestjs/common';
import type {
  Compartment,
  CreateCompartmentInput,
  CreateZoneInput,
  UpdateCompartmentInput,
  UpdateZoneInput,
  Zone,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
import { isUniqueViolation } from '../../common/pg-errors';
import { LocationsRepository } from './locations.repository';

@Injectable()
export class LocationsService {
  constructor(private readonly repo: LocationsRepository) {}

  async list(includeInactive: boolean): Promise<Zone[]> {
    return this.repo.listZones(includeInactive);
  }

  async createZone(input: CreateZoneInput): Promise<Zone> {
    try {
      const id = await this.repo.insertZone(input.name);
      return await this.requireZone(id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A zone with that name already exists');
      throw error;
    }
  }

  async updateZone(id: string, input: UpdateZoneInput): Promise<Zone> {
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
      await this.repo.updateZone(id, { name: input.name, isActive: input.isActive });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A zone with that name already exists');
      throw error;
    }

    return this.requireZone(id);
  }

  async createCompartment(input: CreateCompartmentInput): Promise<Compartment> {
    const zone = await this.repo.findZone(input.zoneId);
    if (!zone) throw new NotFoundError('Zone');

    try {
      const id = await this.repo.insertCompartment(input.zoneId, input.code);
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

  async updateCompartment(id: string, input: UpdateCompartmentInput): Promise<Compartment> {
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
      await this.repo.updateCompartment(id, { code: input.code, isActive: input.isActive });
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
