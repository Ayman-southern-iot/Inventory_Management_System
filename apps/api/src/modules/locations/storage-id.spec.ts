import { describe, expect, it } from 'vitest';
import { DEFAULT_STORAGE_ID_FORMAT, buildStorageId, storageIdToken } from './storage-id';

/**
 * The shape of a shelf label, which gets printed and stuck on a physical shelf. Once assigned
 * it is immutable (migration 0034 enforces that with a trigger), so getting the shape wrong is
 * not something a later release can quietly correct.
 */
describe('storage id', () => {
  const format = DEFAULT_STORAGE_ID_FORMAT;

  it('reads broad to narrow, hyphen separated', () => {
    expect(
      buildStorageId(
        { roomName: 'Laboratory', zoneName: 'Meta', compartmentCode: '1A', serial: 7 },
        format,
      ),
    ).toBe('LAB-MET-1A-0007');
  });

  /**
   * The zero padding is the whole reason the tail is a string. Without it plain alphanumeric
   * sorting puts 10 before 2, and every list of shelves in the building reads wrong — a defect
   * you cannot fix afterwards without reprinting every label.
   */
  it('pads the serial so the codes sort alphanumerically', () => {
    const ids = [1, 2, 10, 100].map((serial) =>
      buildStorageId({ roomName: 'Lab', zoneName: 'A', compartmentCode: 'B', serial }, format),
    );
    expect(ids).toEqual(['LAB-A-B-0001', 'LAB-A-B-0002', 'LAB-A-B-0010', 'LAB-A-B-0100']);
    expect([...ids].sort()).toEqual(ids);
  });

  it('strips punctuation and spaces out of the tokens', () => {
    expect(
      buildStorageId(
        { roomName: 'R & D Store', zoneName: 'Shelf-A', compartmentCode: 'A/1', serial: 3 },
        format,
      ),
    ).toBe('RDS-SHE-A1-0003');
  });

  /** A room called "---" passes the not-blank CHECK and would otherwise yield `--1A-0001`. */
  it('falls back to X rather than emitting an empty token', () => {
    expect(storageIdToken('---', 3)).toBe('X');
    expect(
      buildStorageId({ roomName: '***', zoneName: '!!', compartmentCode: '1A', serial: 1 }, format),
    ).toBe('X-X-1A-0001');
  });

  /**
   * The compartment code is kept whole while room and zone are clipped. "SHELF12" clipped to
   * three characters is a different shelf; "Laboratory" clipped is still recognisably the lab.
   */
  it('keeps the compartment code whole', () => {
    expect(
      buildStorageId(
        { roomName: 'Laboratory', zoneName: 'Nvidia', compartmentCode: 'SHELF12', serial: 1 },
        format,
      ),
    ).toBe('LAB-NVI-SHELF12-0001');
  });

  it('honours a different configured shape', () => {
    expect(
      buildStorageId(
        { roomName: 'Laboratory', zoneName: 'Meta', compartmentCode: '1A', serial: 5 },
        { tokenLength: 2, serialPad: 6, separator: '.' },
      ),
    ).toBe('LA.ME.1A.000005');
  });

  /** Four segments against a product code's two — the fastest visual tell under pressure. */
  it('is visually distinct from a product code', () => {
    const id = buildStorageId(
      { roomName: 'Lab', zoneName: 'Meta', compartmentCode: '1A', serial: 1 },
      format,
    );
    expect(id.split('-')).toHaveLength(4);
    expect('LAP-0001'.split('-')).toHaveLength(2);
  });
});
