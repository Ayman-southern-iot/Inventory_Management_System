import { describe, expect, it } from 'vitest';
import scene from '../assets/scene-v4.json';
import { SCENE_FORMAT, parseSceneAsset } from './asset';

/** Keys whose values are base64 mesh data, not text. */
const MESH_KEYS = new Set(['p', 'n', 'i']);

/** Every string in the asset that is not mesh data, with the key it sits under. */
function textIn(value: unknown, key = ''): Array<[string, string]> {
  if (typeof value === 'string') return MESH_KEYS.has(key) ? [] : [[key, value]];
  if (Array.isArray(value)) return value.flatMap((item) => textIn(item, key));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([child, item]) => textIn(item, child));
  }
  return [];
}

describe('the room scene asset', () => {
  it('parses, and is the format this code reads', () => {
    expect(parseSceneAsset(scene).format).toBe(SCENE_FORMAT);
  });

  it('refuses another format rather than drawing something half-understood', () => {
    expect(() => parseSceneAsset({ ...scene, format: SCENE_FORMAT + 1 })).toThrow();
  });

  /*
   * K2: `/room` must never show who holds anything. Its only other request is `GET /catalogue`,
   * which panel-no-person-data.int-spec.ts pins. The scene itself is public geometry: this proves
   * it carries no text at all — only codes, colours and the part roles the renderer shades by.
   */
  it('carries no free text, so it cannot carry a name (K2)', () => {
    const text = textIn(scene);
    const allowed: Record<string, RegExp> = {
      plan: /^v\d+$/,
      id: /^[A-Z]$/,
      code: /^[A-Z]\d$/,
      cell: /^\d[A-Z](-\d[A-Z])?$/,
      color: /^#[0-9a-f]{6}$/i,
      role: /^(body|front|trim)$/,
    };
    const unexpected = text.filter(([key, value]) => !(allowed[key]?.test(value) ?? false));
    expect(unexpected).toEqual([]);
    expect(text.length).toBeGreaterThan(0);
  });
});
