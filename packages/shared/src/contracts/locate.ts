import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Drawer lights (Phase 13). A search in the web app, on the lab panel or on the voice unit
 * reports which products it found; the API works out which drawers hold them and publishes one
 * event; the controller driving the cabinet's lights long-polls for it.
 *
 * The lights cannot be pushed to — they sit on another network and may move — so the API is the
 * hub and the lights are a client like any other.
 *
 * **K2: an event names drawers, cells and a colour, nothing else.** No product name, code or id,
 * no person. The lights only need to know where to glow. Anyone who can read the feed learns
 * which cells were searched for, and when; read beside the catalogue, which every signed-in user
 * can see, a cell narrows to the products on it. So the feed shows what is being looked for as it
 * happens — never who is looking.
 */

/**
 * The most products one locate may name. A search with more matches than this is too broad to
 * light usefully, so the clients post nothing for it rather than a cabinet full of lights.
 */
export const LOCATE_MAX_PRODUCTS = 5;

export const locateRequestSchema = z.object({
  /** Duplicates are allowed and counted once. */
  productIds: z.array(uuidSchema).min(1).max(LOCATE_MAX_PRODUCTS),
});
export type LocateRequest = z.infer<typeof locateRequestSchema>;

/** `POST /locate` answers before any light reacts; `seq` is null when nothing was published. */
export const locateAcceptedSchema = z.object({ seq: z.number().int().nullable() });
export type LocateAccepted = z.infer<typeof locateAcceptedSchema>;

export const locateNextQuerySchema = z.object({
  /**
   * The last `seq` this light has acted on. Omit it on start-up. An `after` older than anything
   * the API still holds is answered with the newest event, if that event has not expired.
   */
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** Seconds to hold the request open. Capped at the server's maximum; omitted means the maximum. */
  wait: z.coerce.number().int().min(0).optional(),
});
export type LocateNextQuery = z.infer<typeof locateNextQuerySchema>;

/**
 * Green: the drawer holds at least one of the products with some available. Red: the products
 * live there but none is available — out of stock, all on loan, reserved or quarantined.
 */
export const LocateState = {
  GREEN: 'green',
  RED: 'red',
} as const;
export type LocateState = (typeof LocateState)[keyof typeof LocateState];

export const locateDrawerSchema = z.object({
  /** The drawer, as printed on the cabinet, e.g. `B2`. */
  zone: z.string(),
  /** The cabinet it is in, e.g. `Cabinet B`. */
  room: z.string(),
  state: z.nativeEnum(LocateState),
  /** The cells inside the drawer the products occupy, e.g. `2A-2D`. */
  cells: z.array(z.string()),
});
export type LocateDrawer = z.infer<typeof locateDrawerSchema>;

export const locateEventSchema = z.object({
  /** Increases by one per event. It starts from the API's boot time, so it never goes backwards. */
  seq: z.number().int(),
  /** When the event was published, ISO 8601. */
  ts: z.string(),
  /** How long the lights should stay on. The API never hands out an event older than this. */
  ttlMs: z.number().int(),
  drawers: z.array(locateDrawerSchema),
});
export type LocateEvent = z.infer<typeof locateEventSchema>;
