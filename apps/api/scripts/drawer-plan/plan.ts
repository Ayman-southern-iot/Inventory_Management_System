/**
 * The pure half of the drawer-plan entry (scripts/drawer-plan.ts): read the plan's location list
 * and work out what IMS is missing. No I/O here, so every rule is unit-tested.
 *
 * The list is `apps/web/src/features/panel/layout/ims-import-v4.csv`, one row per compartment. Only
 * three of its columns reach IMS: a compartment is a `code` in a zone, a zone is a `name` in a room
 * (OQ-P2). Its label and description columns stay on the plan: IMS has no field for them, and the
 * printed shelf label is the server's `storageId`.
 */
import {
  createCompartmentSchema,
  createRoomSchema,
  createZoneSchema,
  type Room,
} from '@ims/shared';
import { CsvParseError, isBlankRow, parseCsv } from '../../src/modules/imports/csv-parse';
import { stripBom } from '../../src/modules/imports/import-format';

/** The plan file's headers, matched exactly: a renamed column must fail, not be skipped. */
export const PLAN_COLUMNS = {
  room: 'Room',
  zone: 'Zone name',
  compartment: 'Compartment code',
  active: 'Active',
} as const;
type PlanColumn = keyof typeof PLAN_COLUMNS;

/** Every compartment in the plan is meant to be in use; entering an inactive one is not supported. */
const ACTIVE_VALUE = 'TRUE';

export interface PlanRow {
  /** The spreadsheet line, so an error points at the row a person can open. */
  line: number;
  room: string;
  zone: string;
  compartment: string;
}

export interface PlanParseResult {
  rows: PlanRow[];
  errors: string[];
}

/**
 * How the lab panel joins a cell to IMS (`features/panel/address.ts`, `normalise`): trimmed and
 * upper-cased. Matching the same way means the script never creates a second "cabinet a" beside
 * "Cabinet A" that the panel would read as the same drawer.
 */
export function matchKey(text: string): string {
  return text.trim().toUpperCase();
}

export function parsePlanCsv(text: string): PlanParseResult {
  const rows: PlanRow[] = [];
  const errors: string[] = [];

  let records;
  try {
    records = [...parseCsv(stripBom(text))].filter((record) => !isBlankRow(record));
  } catch (error) {
    if (error instanceof CsvParseError) return { rows, errors: [`line ${error.line}: ${error.message}`] };
    throw error;
  }

  const header = records.shift();
  if (header === undefined) return { rows, errors: ['the file has no header row'] };
  const columnAt = {} as Record<PlanColumn, number>;
  for (const column of Object.keys(PLAN_COLUMNS) as PlanColumn[]) {
    columnAt[column] = header.cells.findIndex((cell) => cell.trim() === PLAN_COLUMNS[column]);
    if (columnAt[column] < 0) errors.push(`column "${PLAN_COLUMNS[column]}" is missing`);
  }
  if (errors.length > 0) return { rows, errors };

  const firstLineOf = new Map<string, number>();
  for (const record of records) {
    const cell = (column: PlanColumn) => (record.cells[columnAt[column]] ?? '').trim();
    const row: PlanRow = {
      line: record.line,
      room: cell('room'),
      zone: cell('zone'),
      compartment: cell('compartment'),
    };
    const problem = rowProblem(row, cell('active'));
    if (problem !== null) {
      errors.push(`line ${row.line}: ${problem}`);
      continue;
    }
    const key = compartmentKey(row.room, row.zone, row.compartment);
    const firstLine = firstLineOf.get(key);
    if (firstLine !== undefined) {
      errors.push(`line ${row.line}: the same compartment as line ${firstLine}`);
      continue;
    }
    firstLineOf.set(key, row.line);
    rows.push(row);
  }
  return { rows, errors };
}

/** Checked with the API's own schemas, so a value the server would refuse is refused here first. */
function rowProblem(row: PlanRow, active: string): string | null {
  const empty = (['room', 'zone', 'compartment'] as const).filter((column) => row[column] === '');
  if (empty.length > 0) return `empty ${empty.map((column) => PLAN_COLUMNS[column]).join(', ')}`;
  if (active.toUpperCase() !== ACTIVE_VALUE) {
    return `${PLAN_COLUMNS.active} is "${active}"; only ${ACTIVE_VALUE} rows can be entered`;
  }
  if (!createRoomSchema.shape.name.safeParse(row.room).success) return `room "${row.room}" is not a valid name`;
  if (!createZoneSchema.shape.name.safeParse(row.zone).success) return `zone "${row.zone}" is not a valid name`;
  if (!createCompartmentSchema.shape.code.safeParse(row.compartment).success) {
    return `compartment code "${row.compartment}" is not valid`;
  }
  return null;
}

const KEY_SEPARATOR = '\u0000';
const zoneKey = (room: string, zone: string) => [room, zone].map(matchKey).join(KEY_SEPARATOR);
const compartmentKey = (room: string, zone: string, code: string) =>
  [room, zone, code].map(matchKey).join(KEY_SEPARATOR);

export interface EntryPlan {
  /** Rooms to create, spelled as the plan spells them. */
  rooms: string[];
  zones: { room: string; zone: string }[];
  compartments: { room: string; zone: string; code: string }[];
  /** Plan compartments IMS already has, active or not. */
  present: number;
  /** Plan locations IMS has but marks inactive. Reported, never changed: reactivating is a person's call. */
  inactive: string[];
}

/** What IMS lacks for the plan. Locations the plan does not name are ignored, never touched. */
export function planEntry(rows: readonly PlanRow[], rooms: readonly Room[]): EntryPlan {
  const roomsByKey = new Map(rooms.map((room) => [matchKey(room.name), room]));
  const plan: EntryPlan = { rooms: [], zones: [], compartments: [], present: 0, inactive: [] };
  const planned = new Set<string>();
  const once = (key: string, add: () => void) => {
    if (planned.has(key)) return;
    planned.add(key);
    add();
  };

  for (const row of rows) {
    const room = roomsByKey.get(matchKey(row.room));
    const zone = room?.zones.find((candidate) => matchKey(candidate.name) === matchKey(row.zone));
    const compartment = zone?.compartments.find(
      (candidate) => matchKey(candidate.code) === matchKey(row.compartment),
    );

    if (room === undefined) once(`room${KEY_SEPARATOR}${matchKey(row.room)}`, () => plan.rooms.push(row.room));
    else if (!room.isActive) once(`inactive-room${KEY_SEPARATOR}${room.id}`, () => plan.inactive.push(`room ${room.name}`));

    if (zone === undefined) {
      once(`zone${KEY_SEPARATOR}${zoneKey(row.room, row.zone)}`, () =>
        plan.zones.push({ room: row.room, zone: row.zone }),
      );
    } else if (!zone.isActive) {
      once(`inactive-zone${KEY_SEPARATOR}${zone.id}`, () => plan.inactive.push(`zone ${zone.roomName} / ${zone.name}`));
    }

    if (compartment === undefined) {
      plan.compartments.push({ room: row.room, zone: row.zone, code: row.compartment });
    } else {
      plan.present += 1;
      if (!compartment.isActive) {
        plan.inactive.push(`compartment ${compartment.roomName} / ${compartment.zoneName} / ${compartment.code}`);
      }
    }
  }
  return plan;
}

/**
 * Why `--apply` must not run, or null when it may. An inactive plan location blocks it: the API
 * creates under a retired room or zone without complaint (`locations.service.ts`), and its unique
 * names cover retired rows too (migration 0033), so the run would either write into a retired
 * drawer or stop half-way on a 409. Reactivating or dropping it is a person's decision.
 */
export function applyRefusal(plan: EntryPlan): string | null {
  if (plan.inactive.length === 0) return null;
  return (
    `${plan.inactive.length} plan location(s) are inactive in IMS: reactivate them on the ` +
    'Locations page, or take them off the plan, then run again'
  );
}

/** A room or zone lookup key, matched the way `planEntry` matches. */
export { zoneKey };
