import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Compartment, Room, Zone } from '@ims/shared';
import { matchKey, parsePlanCsv, planEntry, type PlanRow } from './plan';

const HEADER = 'Room,Zone name,Compartment code,Label / QR text,Drawer description (plan only),Description,Active';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\r\n');
const row = (room: string, zone: string, compartment: string, line = 2): PlanRow => ({ line, room, zone, compartment });

let nextId = 0;
const id = () => `00000000-0000-4000-8000-${String((nextId += 1)).padStart(12, '0')}`;

function compartment(zone: Zone, code: string, isActive = true): Compartment {
  return {
    id: id(), zoneId: zone.id, zoneName: zone.name, roomId: zone.roomId, roomName: zone.roomName,
    code, storageId: `${zone.roomName}-${zone.name}-${code}-0001`, isActive, placementCount: 0,
  };
}
function zone(room: Room, name: string, codes: string[], isActive = true): Zone {
  const built: Zone = { id: id(), name, roomId: room.id, roomName: room.name, isActive, compartments: [] };
  built.compartments = codes.map((code) => compartment(built, code));
  return built;
}
function room(name: string, isActive = true): Room {
  return { id: id(), name, isActive, zones: [] };
}

describe('parsePlanCsv', () => {
  it('reads the v4 plan the panel ships: 150 compartments in 4 rooms and 17 zones, no problems', () => {
    const file = resolve(__dirname, '../../../web/src/features/panel/layout/ims-import-v4.csv');
    const { rows, errors } = parsePlanCsv(readFileSync(file, 'utf8'));

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(150);
    expect(new Set(rows.map((r) => r.room))).toEqual(
      new Set(['Cabinet A', 'Cabinet B', 'Roller cabinet', 'CTO Room — open shelves']),
    );
    expect(new Set(rows.map((r) => `${r.room}/${r.zone}`)).size).toBe(17);
    expect(rows[0]).toEqual({ line: 2, room: 'Cabinet A', zone: 'A1', compartment: '1A-1B' });
  });

  it('keeps a quoted comma inside its cell', () => {
    const { rows } = parsePlanCsv(csv('Cabinet A,A1,1A-1B,A1-1A-1B,"A1 · Tools — debug, soldering",Hand tools,TRUE'));
    expect(rows).toEqual([row('Cabinet A', 'A1', '1A-1B')]);
  });

  it('refuses a file whose column was renamed, naming the column', () => {
    const { rows, errors } = parsePlanCsv('Room,Zone,Compartment code,Active\r\nCabinet A,A1,1A,TRUE');
    expect(rows).toEqual([]);
    expect(errors).toEqual(['column "Zone name" is missing']);
  });

  it('refuses empty cells, an inactive row and a repeated compartment, each by line', () => {
    const { rows, errors } = parsePlanCsv(
      csv(
        'Cabinet A,A1,1A,x,x,x,TRUE',
        'Cabinet A,,1B,x,x,x,TRUE',
        'Cabinet A,A1,1C,x,x,x,FALSE',
        ' cabinet a ,a1,1a,x,x,x,TRUE',
      ),
    );
    expect(rows.map((r) => r.compartment)).toEqual(['1A']);
    expect(errors).toEqual([
      'line 3: empty Zone name',
      'line 4: Active is "FALSE"; only TRUE rows can be entered',
      'line 5: the same compartment as line 2',
    ]);
  });

  it('refuses a compartment code the API would refuse', () => {
    const tooLong = 'X'.repeat(33);
    const { errors } = parsePlanCsv(csv(`Cabinet A,A1,${tooLong},x,x,x,TRUE`));
    expect(errors).toEqual([`line 2: compartment code "${tooLong}" is not valid`]);
  });

  it('reports a broken quote instead of throwing', () => {
    const { errors } = parsePlanCsv(csv('Cabinet A,A1,"1A,x,x,x,TRUE'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^line \d+: /);
  });
});

describe('planEntry', () => {
  const rows = [
    row('Cabinet A', 'A1', '1A-1B', 2),
    row('Cabinet A', 'A1', '1C-1D', 3),
    row('Cabinet A', 'A2', '1A', 4),
    row('Roller cabinet', 'R1', '1A', 5),
  ];

  it('creates every room, zone and compartment on an empty IMS, each room and zone once', () => {
    const plan = planEntry(rows, []);
    expect(plan.rooms).toEqual(['Cabinet A', 'Roller cabinet']);
    expect(plan.zones).toEqual([
      { room: 'Cabinet A', zone: 'A1' },
      { room: 'Cabinet A', zone: 'A2' },
      { room: 'Roller cabinet', zone: 'R1' },
    ]);
    expect(plan.compartments).toHaveLength(4);
    expect(plan.present).toBe(0);
  });

  it('matches what exists the way the panel does, ignoring case and spaces, so it creates no near-duplicate', () => {
    const cabinet = room(' CABINET a ');
    cabinet.zones = [zone(cabinet, 'a1', ['1a-1b'])];
    const plan = planEntry(rows, [cabinet]);

    expect(plan.rooms).toEqual(['Roller cabinet']);
    expect(plan.zones).toEqual([
      { room: 'Cabinet A', zone: 'A2' },
      { room: 'Roller cabinet', zone: 'R1' },
    ]);
    expect(plan.compartments.map((c) => `${c.zone}/${c.code}`)).toEqual(['A1/1C-1D', 'A2/1A', 'R1/1A']);
    expect(plan.present).toBe(1);
  });

  it('leaves alone what the plan does not name, and finds a zone only in its own room', () => {
    const store = room('Main Store');
    store.zones = [zone(store, 'A1', ['1A-1B'])];
    const plan = planEntry(rows, [store]);
    expect(plan.rooms).toEqual(['Cabinet A', 'Roller cabinet']);
    expect(plan.compartments).toHaveLength(4);
  });

  it('creates nothing once everything exists', () => {
    const cabinet = room('Cabinet A');
    cabinet.zones = [zone(cabinet, 'A1', ['1A-1B', '1C-1D']), zone(cabinet, 'A2', ['1A'])];
    const roller = room('Roller cabinet');
    roller.zones = [zone(roller, 'R1', ['1A'])];
    const plan = planEntry(rows, [cabinet, roller]);
    expect(plan).toEqual({ rooms: [], zones: [], compartments: [], present: 4, inactive: [] });
  });

  it('reports an inactive room, zone or compartment once each and never plans to recreate it', () => {
    const cabinet = room('Cabinet A', false);
    const a1 = zone(cabinet, 'A1', ['1A-1B'], false);
    a1.compartments.push(compartment(a1, '1C-1D', false));
    cabinet.zones = [a1, zone(cabinet, 'A2', ['1A'])];
    const plan = planEntry(rows, [cabinet]);

    expect(plan.inactive).toEqual(['room Cabinet A', 'zone Cabinet A / A1', 'compartment Cabinet A / A1 / 1C-1D']);
    expect(plan.rooms).toEqual(['Roller cabinet']);
    expect(plan.present).toBe(3);
  });

  it('keys by trimmed, upper-cased text', () => {
    expect(matchKey('  Cabinet a ')).toBe('CABINET A');
  });
});
