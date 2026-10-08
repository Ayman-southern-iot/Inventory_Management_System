import { Color, SRGBColorSpace } from 'three';

/**
 * The scene's colours, read from the design tokens at runtime so the 3D view follows the same
 * light and dark values as everything around it (tokens.css; `/room` opts into the dark set the
 * way `/panel` does). The model's own materials — wood, metal, the drawer bands — are data in
 * the scene asset and the plan, and do not change with the theme.
 */
export interface ScenePalette {
  floor: Color;
  shellEdge: Color;
  glass: Color;
  /** Selection: the glow, the frames and the light over the cell. */
  highlight: Color;
  /** A cell holding stock, and one that does not. */
  stocked: Color;
  empty: Color;
  /** Drawer-front labels, as CSS colours for the 2D canvas they are drawn on. */
  labelPaper: string;
  labelInk: string;
  badge: string;
  badgeInk: string;
  fontFamily: string;
}

/**
 * Chosen to match the renderer's own palette where the tokens allow: near-white glass and dark
 * edge lines in light mode, a grey floor; light lines on a dark floor in dark mode.
 */
const TOKENS = {
  floor: '--color-border',
  shellEdge: '--color-ink',
  glass: '--color-surface',
  highlight: '--color-brand',
  stocked: '--color-success',
  empty: '--color-border-strong',
  labelPaper: '--color-surface',
  labelInk: '--color-ink',
  badge: '--color-brand',
  badgeInk: '--color-on-brand',
} as const;

/**
 * three.js parses hex, rgb() and hsl(), but the tokens are oklch(). The 2D canvas understands
 * every CSS colour, so one pixel painted with the token and read back gives its sRGB value.
 */
function toColour(css: string, probe: CanvasRenderingContext2D): Color {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;
  const channel = 255;
  return new Color().setRGB(red / channel, green / channel, blue / channel, SRGBColorSpace);
}

export function readPalette(themeSource: HTMLElement): ScenePalette {
  const style = getComputedStyle(themeSource);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (probe === null) throw new Error('No 2D canvas to read the theme colours with');
  const colour = (name: string) => toColour(token(name), probe);
  return {
    floor: colour(TOKENS.floor),
    shellEdge: colour(TOKENS.shellEdge),
    glass: colour(TOKENS.glass),
    highlight: colour(TOKENS.highlight),
    stocked: colour(TOKENS.stocked),
    empty: colour(TOKENS.empty),
    labelPaper: token(TOKENS.labelPaper),
    labelInk: token(TOKENS.labelInk),
    badge: token(TOKENS.badge),
    badgeInk: token(TOKENS.badgeInk),
    fontFamily: style.fontFamily,
  };
}
