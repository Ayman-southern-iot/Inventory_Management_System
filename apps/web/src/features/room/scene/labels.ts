import { CanvasTexture, SRGBColorSpace } from 'three';
import {
  LABEL_ANISOTROPY,
  LABEL_BADGE_FONT_PX,
  LABEL_BAND_PX,
  LABEL_CANVAS_PX,
  LABEL_CODE_FONT_PX,
  LABEL_NAME_FONT_PX,
  LABEL_PAD_PX,
  LABEL_RADIUS_PX,
} from '../constants';
import type { ScenePalette } from './palette';

const ELLIPSIS = '…';

/** `text`, shortened with an ellipsis until it fits `width`. */
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let shortened = text;
  while (shortened.length > 1 && context.measureText(shortened + ELLIPSIS).width > width) {
    shortened = shortened.slice(0, -1);
  }
  return shortened + ELLIPSIS;
}

/** Splits `text` into at most two lines that fit `width`; the second is ellipsised if needed. */
function twoLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  let first = '';
  let second = '';
  for (const word of text.split(' ')) {
    const candidate = first === '' ? word : `${first} ${word}`;
    if (second === '' && context.measureText(candidate).width < width) first = candidate;
    else second = second === '' ? word : `${second} ${word}`;
  }
  return second === '' ? [first] : [first, fit(context, second, width)];
}

/**
 * The label on a drawer front: its colour band, its code (A1–A5, B1–B5, R1–R5), its name from the
 * plan, and — when IMS has parts in it — a count badge, so a closed drawer still says it holds
 * something. Redrawn when the stock or the theme changes.
 */
export class DrawerLabel {
  readonly texture: CanvasTexture;
  private readonly canvas = document.createElement('canvas');

  constructor(
    private readonly code: string,
    private readonly name: string,
    /** `#RRGGBB` from the plan; null for a drawer with no band. */
    private readonly band: string | null,
  ) {
    [this.canvas.width, this.canvas.height] = LABEL_CANVAS_PX;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = LABEL_ANISOTROPY;
  }

  draw(palette: ScenePalette, parts: number): void {
    const context = this.canvas.getContext('2d');
    if (context === null) return;
    const [width, height] = LABEL_CANVAS_PX;
    const font = (weight: number, px: number) => `${weight} ${px}px ${palette.fontFamily}`;

    context.clearRect(0, 0, width, height);
    context.fillStyle = palette.labelPaper;
    context.beginPath();
    context.roundRect(0, 0, width, height, LABEL_RADIUS_PX);
    context.fill();
    if (this.band !== null) {
      context.fillStyle = this.band;
      context.fillRect(0, 0, LABEL_BAND_PX, height);
    }

    let right = width - LABEL_PAD_PX;
    if (parts > 0) {
      const radius = height / 2 - LABEL_PAD_PX;
      const centreX = right - radius;
      context.fillStyle = palette.badge;
      context.beginPath();
      context.arc(centreX, height / 2, radius, 0, 2 * Math.PI);
      context.fill();
      context.fillStyle = palette.badgeInk;
      context.font = font(700, LABEL_BADGE_FONT_PX);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(fit(context, String(parts), radius * 2), centreX, height / 2);
      right = centreX - radius - LABEL_PAD_PX;
    }

    context.fillStyle = palette.labelInk;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const codeX = LABEL_BAND_PX + LABEL_PAD_PX;
    context.font = font(700, LABEL_CODE_FONT_PX);
    context.fillText(this.code, codeX, height / 2);
    const nameX = codeX + context.measureText(this.code).width + LABEL_PAD_PX;
    context.font = font(600, LABEL_NAME_FONT_PX);
    const lines = twoLines(context, this.name, right - nameX);
    const lineHeight = height / (lines.length + 1);
    lines.forEach((line, index) => context.fillText(line, nameX, lineHeight * (index + 1)));

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
