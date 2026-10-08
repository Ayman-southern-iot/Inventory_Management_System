/**
 * Tuning for the 3D room view. The scene is in millimetres, so every distance here is mm.
 * Most values are carried over from the 3D renderer the scene comes from; where three.js r186
 * changed a meaning (light units), the comment says how the value was converted.
 */

export const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';
export const DARK_SCHEME_MEDIA = '(prefers-color-scheme: dark)';

/** Results shown under the search box; more are counted, not listed. */
export const ROOM_MAX_RESULTS = 12;

// Camera
export const CAMERA_FOV_DEG = 38;
export const CAMERA_NEAR_MM = 20;
export const CAMERA_FAR_MM = 80_000;
export const MAX_PIXEL_RATIO = 2;
export const ORBIT_DAMPING = 0.09;
export const ORBIT_MIN_DISTANCE_MM = 250;
export const ORBIT_MAX_DISTANCE_MM = 20_000;
/** Just short of horizontal, so the camera never dips under the floor. */
export const ORBIT_MAX_POLAR_RAD = Math.PI * 0.495;
/** How far the camera keeps from the walls when a flight would end outside the room. */
export const ROOM_WALL_MARGIN_MM = 160;
export const ROOM_FLOOR_MARGIN_MM = 350;
export const ROOM_CEILING_MARGIN_MM = 120;
export const FLIGHT_MS = 1_300;
export const FLIGHT_REFOCUS_MS = 700;
export const FIRST_FLIGHT_MS = 1_600;
export const FLIGHT_MAX_LIFT_MM = 700;
/** A pointer that moved further than this between down and up was a drag, not a click. */
export const CLICK_TOLERANCE_PX = 6;

// Lights. three.js r155 made physical light units the only mode; the renderer used the legacy
// ones, which carried a hidden factor of π. Multiplying by π keeps its look.
export const HEMISPHERE_INTENSITY = 0.62 * Math.PI;
export const SUN_INTENSITY = 0.95 * Math.PI;
export const SUN_OFFSET_MM: readonly [number, number, number] = [1_600, 6_500, 2_600];
/** Light colours as sRGB channels (0–1): white sky, a grey-green floor bounce, a warm sun. */
export const SKY_LIGHT_SRGB: readonly [number, number, number] = [1, 1, 1];
export const GROUND_LIGHT_SRGB: readonly [number, number, number] = [0.49, 0.514, 0.502];
export const SUN_LIGHT_SRGB: readonly [number, number, number] = [1, 0.965, 0.925];
/** The floor sits this far under the cabinets' feet, so the two never z-fight. */
export const FLOOR_DROP_MM = 12;
export const SHADOW_MAP_SIZE = 2_048;
export const SHADOW_EXTENT_MM = 4_200;
export const SHADOW_NEAR_MM = 500;
export const SHADOW_FAR_MM = 16_000;
export const SHADOW_BIAS = -0.0012;
export const SHADOW_NORMAL_BIAS = 14;
/**
 * The light over the selection. Physical point lights fall off with the square of the distance,
 * which in millimetres leaves nothing at a few hundred mm, so decay is 0 and the cut-off distance
 * shapes it instead.
 */
export const LED_RANGE_MM = 1_400;
export const LED_HEIGHT_MM = 260;
export const LED_BASE_INTENSITY = 1.2 * Math.PI;
export const LED_PULSE_INTENSITY = 1.1 * Math.PI;
/** One breath of the selection's glow and light: the renderer's sin(t / 320 ms), about 2 s. */
export const PULSE_PERIOD_MS = 2_010;

// Materials
export const FLOOR_ROUGHNESS = 0.95;
export const PART_ROUGHNESS = 0.6;
export const FRONT_ROUGHNESS = 0.45;
export const PART_METALNESS = 0.02;
export const GLASS_OPACITY = 0.07;
export const GLASS_ROUGHNESS = 0.1;
export const SHELL_EDGE_OPACITY = 0.6;
/** Draw order of the transparent layers: the room's glass, then the selection glow, then frames. */
export const SHELL_RENDER_ORDER = 3;
export const GLOW_RENDER_ORDER = 4;
export const FRAME_RENDER_ORDER = 5;
/** Outline colour = the part's own colour scaled by this: dark, but of the same hue. */
export const PART_EDGE_DARKEN = 0.18;
export const PART_EDGE_OPACITY = 0.55;
/** Degrees between faces before EdgesGeometry draws the shared edge. */
export const SHELL_EDGE_ANGLE_DEG = 20;
export const PART_EDGE_ANGLE_DEG = 25;
/** The cabinets not being looked at fade to this, so the one that is stands out. */
export const UNFOCUSED_OPACITY = 0.2;
export const FADE_RATE = 7;

// Drawers and cells
/** Opening speed in drawer lengths per second; closing is a little quicker. */
export const DRAWER_OPEN_RATE = 1.25;
export const DRAWER_CLOSE_FACTOR = 1.4;
/** A drawer this far open shows its cells and lets them be clicked. */
export const DRAWER_CELLS_VISIBLE_AT = 0.6;
/** A cell is drawn as a tray of this fraction of its height, inset from the dividers. */
export const CELL_FILL_HEIGHT = 0.35;
export const CELL_INSET_MM = 10;
export const EMPTY_CELL_OPACITY = 0.18;
export const GLOW_INSET_MM = 10;
export const FRAME_INSET_MM = 3;
export const HOVER_OUTSET_MM = 6;
export const DRAWER_FRAME_OUTSET_MM = 10;
export const GLOW_CELL_OPACITY = 0.22;
export const GLOW_CELL_PULSE = 0.26;
export const GLOW_DRAWER_OPACITY = 0.08;
export const GLOW_DRAWER_PULSE = 0.12;
export const HOVER_OPACITY = 0.75;
export const DRAWER_FRAME_OPACITY = 0.55;
/** The pulse sits at this level when the user has asked for less motion. */
export const STEADY_PULSE = 0.7;
export const MAX_FRAME_SECONDS = 0.1;

// Drawer-front labels, drawn on a canvas and mapped onto the front.
export const LABEL_CANVAS_PX: readonly [number, number] = [1_024, 252];
export const LABEL_RADIUS_PX = 18;
export const LABEL_BAND_PX = 64;
export const LABEL_PAD_PX = 30;
export const LABEL_CODE_FONT_PX = 132;
export const LABEL_NAME_FONT_PX = 50;
export const LABEL_BADGE_FONT_PX = 84;
export const LABEL_ANISOTROPY = 4;
/** Tags over the cabinets and the selection float this far above them. */
export const TAG_LIFT_MM = 80;
export const SELECTION_TAG_LIFT_MM = 30;

/**
 * How each view frames its subject, carried over from the renderer: paddings around the
 * subject, distance limits, and how much of the distance goes sideways and up so the view is
 * three-quarter rather than flat-on.
 */
export const FRAMING = {
  /** Below this the view is treated as this narrow, so a tall subject still fits. */
  minFitAspect: 0.4,
  drawer: {
    /** Aim a little below the open drawer's top edge, at its contents. */
    lookBelowTopMm: 40,
    /** How far the aim moves from the drawer's centre toward a selected cell. */
    cellPull: 0.45,
    widthPad: 1.3,
    heightShare: 0.78,
    minMm: 1_800,
    maxMm: 3_600,
    frontShare: 0.6,
    upShare: 0.86,
    sideShare: 0.1,
  },
  overview: {
    direction: [0.62, 0.8, 0.58] as const,
    radii: 1.95,
    /** More room when the view is taller than wide. */
    portraitRadii: 2.3,
    heightRadii: 1.6,
    targetXShare: 0.8,
    targetYShare: 0.2,
    /** Where the camera starts before its first flight in, as shares of the room's size. */
    startOffsetShare: [0.5, 1.2, 0.6] as const,
  },
  /** A flight arcs up by this share of its length, at most FLIGHT_MAX_LIFT_MM. */
  liftShare: 0.1,
} as const;

/** The selection pulse swings between PULSE_FLOOR and PULSE_FLOOR + PULSE_SWING. */
export const PULSE_FLOOR = 0.55;
export const PULSE_SWING = 0.45;
/** Tags just outside the view (normalised device coordinates) still count as on screen. */
export const TAG_VISIBLE_NDC = 1.05;
/** A cabinet at least this opaque can be clicked through a fade. */
export const PICKABLE_OPACITY = 0.9;
/** Opacity changes smaller than this are treated as done. */
export const FADE_EPSILON = 0.004;
/** A part this faint is not drawn at all. */
export const HIDDEN_BELOW_OPACITY = 0.02;
