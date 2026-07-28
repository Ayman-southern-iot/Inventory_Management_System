/**
 * Deterministic colour for a storage zone.
 *
 * The IM reads a product card by shape before they read it by text — "the Meta chips are the
 * blue ones". That only works if a zone keeps its colour forever, across reloads, across
 * machines and across whatever order the API happens to return placements in. So the colour is
 * a pure function of the zone id, never of the render order and never random.
 *
 * The palette is a fixed ring of six semantic tokens (styles/tokens.css). Six zones will
 * collide eventually; a collision is cosmetic, an unstable colour is a lie about the data.
 */

/**
 * Full Tailwind class strings, not composed at runtime — the scanner only sees literals, so
 * `bg-zone-${n}-subtle` would ship a chip with no background at all.
 */
export const ZONE_TONES = [
  'border-zone-1 bg-zone-1-subtle text-zone-1',
  'border-zone-2 bg-zone-2-subtle text-zone-2',
  'border-zone-3 bg-zone-3-subtle text-zone-3',
  'border-zone-4 bg-zone-4-subtle text-zone-4',
  'border-zone-5 bg-zone-5-subtle text-zone-5',
  'border-zone-6 bg-zone-6-subtle text-zone-6',
] as const;

export type ZoneTone = (typeof ZONE_TONES)[number];

/* FNV-1a: cheap, dependency-free, and spreads uuids across the ring far better than a sum. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashToUnsigned32(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // imul keeps the multiply in 32-bit space; a plain `*` loses precision and stops being a hash.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function zoneToneFor(zoneId: string): ZoneTone {
  return ZONE_TONES[hashToUnsigned32(zoneId) % ZONE_TONES.length]!;
}
