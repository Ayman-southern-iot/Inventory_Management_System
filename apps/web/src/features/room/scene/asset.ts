import { z } from 'zod';

/**
 * The room scene `/room` draws: the 3D model's meshes and boxes, in world millimetres.
 *
 * Produced by `scripts/room-scene/extract-scene.mjs` from the 3D renderer's page, which also
 * checks it against the drawer plan before writing it. Geometry only: names, addresses and
 * stock come from the plan and IMS, never from here (see asset.test.ts for the K2 check).
 */

/** The shape `extract-scene.mjs` writes. Any other value is refused, not guessed at. */
export const SCENE_FORMAT = 1;

/** Mesh positions are int16 in half millimetres: the stored value divided by this is mm. */
export const POSITION_STEPS_PER_MM = 2;
/** Mesh normals are int8: the stored value divided by this is the unit-vector component. */
export const NORMAL_STEPS_PER_UNIT = 127;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof vec3>;

const geometrySchema = z.object({
  /** Base64 int16 positions, three per vertex. */
  p: z.string().min(1),
  /** Base64 int8 normals, three per vertex. */
  n: z.string().min(1),
  /** Base64 triangle indices: uint16, or uint32 when `i32` is set. */
  i: z.string().min(1),
  i32: z.literal(true).optional(),
});
export type SceneGeometry = z.infer<typeof geometrySchema>;

const colourSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

const partSchema = z.object({
  /** `front` parts are shaded a little glossier; the rest are matt. */
  role: z.string().optional(),
  color: colourSchema,
  /** False when the renderer drew this part without its outline. */
  edges: z.literal(false).optional(),
  geo: geometrySchema,
});
export type ScenePart = z.infer<typeof partSchema>;

const cellSchema = z.object({ cell: z.string().min(1), min: vec3, max: vec3 });

const drawerSchema = z.object({
  code: z.string().min(1),
  color: colourSchema,
  min: vec3,
  max: vec3,
  /** Where the drawer-front label sits, and its width × height in mm. */
  labelAt: vec3,
  labelSize: z.tuple([z.number().positive(), z.number().positive()]),
  geo: geometrySchema,
  cells: z.array(cellSchema).min(1),
});

const cabinetSchema = z.object({
  id: z.string().min(1),
  movable: z.boolean(),
  min: vec3,
  max: vec3,
  /** Unit vector out of the drawer fronts: the way a drawer slides when it opens. */
  front: vec3,
  /** How far a drawer slides out when fully open, in mm. */
  slide: z.number().positive(),
  parts: z.array(partSchema),
  drawers: z.array(drawerSchema).min(1),
});

export const sceneAssetSchema = z.object({
  format: z.literal(SCENE_FORMAT),
  /** The drawer-plan version the scene was checked against, e.g. `v4`. */
  plan: z.string().min(1),
  room: z.object({ min: vec3, max: vec3 }),
  /** The room's walls, drawn as faint glass so the cabinets stay visible from any side. */
  shell: geometrySchema,
  cabinets: z.array(cabinetSchema).min(1),
  /** Furniture that is not storage: drawn for orientation, never picked. */
  decor: z.array(partSchema),
});
export type SceneAsset = z.infer<typeof sceneAssetSchema>;
export type SceneCabinet = SceneAsset['cabinets'][number];
export type SceneDrawer = SceneCabinet['drawers'][number];

/** A malformed or wrong-format scene fails here, loudly, before anything is drawn. */
export function parseSceneAsset(raw: unknown): SceneAsset {
  return sceneAssetSchema.parse(raw);
}
