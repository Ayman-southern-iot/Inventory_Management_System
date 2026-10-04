import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { DomainError } from '../../common/errors';

/**
 * Each of these was a bare `ConflictError`. The SPA selects its wording by `code`, and CONFLICT
 * covers about forty unrelated refusals, so a duplicate name could only be answered with a
 * sentence that fits all of them. A code of its own lets the screen say what clashed.
 * Still 409, so nothing that checks the status changes.
 */
export class DuplicateRoomNameError extends DomainError {
  constructor() {
    super(ErrorCode.DUPLICATE_ROOM_NAME, 'A room with that name already exists', HttpStatus.CONFLICT);
  }
}

export class DuplicateZoneNameError extends DomainError {
  constructor(zoneName: string, roomName?: string) {
    super(
      ErrorCode.DUPLICATE_ZONE_NAME,
      roomName
        ? `A zone called "${zoneName}" already exists in ${roomName}`
        : 'A zone with that name already exists in this room',
      HttpStatus.CONFLICT,
      { zoneName, ...(roomName ? { roomName } : {}) },
    );
  }
}

export class DuplicateCompartmentCodeError extends DomainError {
  constructor(code: string, zoneName?: string) {
    super(
      ErrorCode.DUPLICATE_COMPARTMENT_CODE,
      zoneName
        ? `Compartment "${code}" already exists in ${zoneName}`
        : 'Another compartment in this zone already uses that code',
      HttpStatus.CONFLICT,
      { code, ...(zoneName ? { zoneName } : {}) },
    );
  }
}

export type LocationKind = 'room' | 'zone' | 'compartment';

/** A room, zone or compartment cannot be deactivated while stock is still stored in it. */
export class LocationHoldsStockError extends DomainError {
  constructor(kind: LocationKind, count: number) {
    super(
      ErrorCode.LOCATION_HOLDS_STOCK,
      `This ${kind} still holds stock (${count}). Move or issue it first.`,
      HttpStatus.CONFLICT,
      { kind, count },
    );
  }
}
