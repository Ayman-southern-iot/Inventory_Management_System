import {
  type Color,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PointLight,
  type Scene,
  Vector3,
} from 'three';
import {
  DRAWER_FRAME_OPACITY,
  DRAWER_FRAME_OUTSET_MM,
  FRAME_INSET_MM,
  FRAME_RENDER_ORDER,
  GLOW_RENDER_ORDER,
  GLOW_CELL_OPACITY,
  GLOW_CELL_PULSE,
  GLOW_DRAWER_OPACITY,
  GLOW_DRAWER_PULSE,
  GLOW_INSET_MM,
  HOVER_OPACITY,
  HOVER_OUTSET_MM,
  LED_BASE_INTENSITY,
  LED_HEIGHT_MM,
  LED_PULSE_INTENSITY,
  SELECTION_TAG_LIFT_MM,
} from '../constants';
import type { BoxGeometry } from 'three';
import type { CellView, DrawerView } from './build';
import type { Box } from './camera';

interface Target {
  drawer: DrawerView;
  cell: CellView | null;
}

interface HighlightFrame {
  focus: Target | null;
  hovered: Target | null;
  /** 0–1, the selection's breathing. */
  pulse: number;
  led: PointLight;
  /** Positions the tag over `point`; false when that point is off screen or mid-flight. */
  tagVisible: (point: Vector3, element: HTMLElement) => boolean;
}

/**
 * What marks the selection: a breathing glow on the cell (or on the whole tray when a drawer is
 * chosen without a cell), a frame round the cell and round its drawer, the light hung over it,
 * a tag naming it, and a lighter frame under the mouse. All in the highlight token colour.
 */
export class Highlight {
  private readonly glowMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  private readonly glow: Mesh;
  private readonly edges: EdgesGeometry;
  private readonly cellFrame: LineSegments;
  private readonly drawerFrame: LineSegments;
  private readonly hoverFrame: LineSegments;
  private readonly lineMaterials: LineBasicMaterial[] = [];
  private readonly at = new Vector3();
  private tag: HTMLElement | null = null;

  constructor(scene: Scene, unitBox: BoxGeometry) {
    this.glow = new Mesh(unitBox, this.glowMaterial);
    this.edges = new EdgesGeometry(unitBox);
    this.glow.visible = false;
    this.glow.renderOrder = GLOW_RENDER_ORDER;
    scene.add(this.glow);
    this.cellFrame = this.frame(scene, 1);
    this.drawerFrame = this.frame(scene, DRAWER_FRAME_OPACITY);
    this.hoverFrame = this.frame(scene, HOVER_OPACITY);
  }

  attachTag(overlay: HTMLElement, className: string): void {
    this.tag = document.createElement('div');
    this.tag.className = className;
    this.tag.hidden = true;
    overlay.append(this.tag);
  }

  setColour(colour: Color): void {
    this.glowMaterial.color.copy(colour);
    for (const material of this.lineMaterials) material.color.copy(colour);
  }

  update({ focus, hovered, pulse, led, tagVisible }: HighlightFrame): void {
    this.updateHover(focus, hovered);
    if (focus === null) {
      this.glow.visible = this.cellFrame.visible = this.drawerFrame.visible = false;
      led.intensity = 0;
      if (this.tag !== null) this.tag.hidden = true;
      return;
    }
    const offset = focus.drawer.group.position;
    this.place(this.drawerFrame, focus.drawer.box, -DRAWER_FRAME_OUTSET_MM, offset);
    this.place(this.glow, focus.cell?.box ?? focus.drawer.cellBounds, GLOW_INSET_MM, offset);
    this.glowMaterial.opacity =
      focus.cell === null
        ? GLOW_DRAWER_OPACITY + GLOW_DRAWER_PULSE * pulse
        : GLOW_CELL_OPACITY + GLOW_CELL_PULSE * pulse;
    if (focus.cell === null) this.cellFrame.visible = false;
    else this.place(this.cellFrame, focus.cell.box, FRAME_INSET_MM, offset);

    const subject = (focus.cell ?? focus.drawer).box;
    led.position.copy(subject.centre).add(offset);
    led.position.y += LED_HEIGHT_MM;
    led.intensity = LED_BASE_INTENSITY + LED_PULSE_INTENSITY * pulse;

    if (this.tag !== null) {
      const drawerTop = focus.drawer.box.centre.y + focus.drawer.box.size.y / 2;
      this.at
        .copy(subject.centre)
        .add(offset)
        .setY(drawerTop + SELECTION_TAG_LIFT_MM);
      this.tag.textContent = focus.cell?.cell.address ?? focus.drawer.drawer.code;
      this.tag.hidden = !tagVisible(this.at, this.tag);
    }
  }

  dispose(): void {
    this.tag?.remove();
    this.edges.dispose();
    this.glowMaterial.dispose();
    for (const material of this.lineMaterials) material.dispose();
  }

  private updateHover(focus: Target | null, hovered: Target | null): void {
    const isSelected =
      hovered !== null &&
      focus !== null &&
      (hovered.cell === null ? focus.drawer === hovered.drawer : focus.cell === hovered.cell);
    if (hovered === null || isSelected) {
      this.hoverFrame.visible = false;
      return;
    }
    const subject = hovered.cell?.box ?? hovered.drawer.box;
    const inset = hovered.cell === null ? -HOVER_OUTSET_MM : HOVER_OUTSET_MM;
    this.place(this.hoverFrame, subject, inset, hovered.drawer.group.position);
  }

  private frame(scene: Scene, opacity: number): LineSegments {
    const material = new LineBasicMaterial({ transparent: true, opacity, depthTest: false });
    this.lineMaterials.push(material);
    const frame = new LineSegments(this.edges, material);
    frame.visible = false;
    // Over everything else, so a frame is never hidden inside the drawer it outlines.
    frame.renderOrder = FRAME_RENDER_ORDER;
    scene.add(frame);
    return frame;
  }

  /** Fits a unit-box object to `box`, shrunk by `inset` mm (grown when negative), then shown. */
  private place(object: Object3D, box: Box, inset: number, offset: Vector3): void {
    object.position.copy(box.centre).add(offset);
    object.scale.set(
      Math.max(1, box.size.x - inset),
      Math.max(1, box.size.y - inset),
      Math.max(1, box.size.z - inset),
    );
    object.visible = true;
  }
}
