import {
  LineSegments,
  Mesh,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { t } from '@/i18n/en';
import {
  CAMERA_FAR_MM,
  CAMERA_FOV_DEG,
  CAMERA_NEAR_MM,
  CLICK_TOLERANCE_PX,
  DARK_SCHEME_MEDIA,
  DRAWER_CELLS_VISIBLE_AT,
  DRAWER_CLOSE_FACTOR,
  DRAWER_OPEN_RATE,
  FADE_EPSILON,
  FADE_RATE,
  FLIGHT_MS,
  FLIGHT_REFOCUS_MS,
  HIDDEN_BELOW_OPACITY,
  MAX_FRAME_SECONDS,
  MAX_PIXEL_RATIO,
  ORBIT_DAMPING,
  ORBIT_MAX_DISTANCE_MM,
  ORBIT_MAX_POLAR_RAD,
  ORBIT_MIN_DISTANCE_MM,
  PART_EDGE_OPACITY,
  PICKABLE_OPACITY,
  PULSE_FLOOR,
  PULSE_PERIOD_MS,
  PULSE_SWING,
  STEADY_PULSE,
  TAG_LIFT_MM,
  TAG_VISIBLE_NDC,
  UNFOCUSED_OPACITY,
} from '../constants';
import { MS_PER_SECOND } from '@/features/panel/constants';
import type { RoomModel, RoomPick } from '../model';
import {
  buildScene,
  type BuiltScene,
  type CabinetView,
  type CellView,
  type DrawerView,
  type FadeGroup,
} from './build';
import { CameraRig } from './camera';
import { Highlight } from './highlight';
import { readPalette, type ScenePalette } from './palette';

export interface RoomSceneOptions {
  canvas: HTMLCanvasElement;
  /** Positioned over the canvas, same size: holds the cabinet and selection tags. */
  overlay: HTMLElement;
  /** The element whose design tokens colour the scene (`readPalette`). */
  themeSource: HTMLElement;
  model: RoomModel;
  reducedMotion: boolean;
  onPick: (pick: RoomPick) => void;
  /** Called once, after the first frame is on screen. */
  onFirstFrame: () => void;
}

interface Focus {
  drawer: DrawerView;
  cell: CellView | null;
}

/** `PointerEvent.button` of the main (usually left) button. */
const PRIMARY_BUTTON = 0;
const TAG_CLASS =
  'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-control border border-border bg-surface px-2 py-1 text-xs font-semibold text-ink shadow-panel';
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * The 3D room: the 3D renderer's scene, camera work and picking, ported from its standalone page
 * to three.js r186 and driven by `/room`'s React state. React owns what is selected; this draws
 * it, and reports clicks through `onPick`. Everything it creates is released by `dispose()`.
 */
export class RoomScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR_MM, CAMERA_FAR_MM);
  private readonly controls: OrbitControls;
  private readonly rig: CameraRig;
  private readonly built: BuiltScene;
  private readonly highlight: Highlight;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly projected = new Vector3();
  private readonly drawerByHit = new Map<Object3D, DrawerView>();
  private readonly cellByHit = new Map<Object3D, { drawer: DrawerView; cell: CellView }>();
  private readonly tags = new Map<CabinetView, { element: HTMLElement; at: Vector3 }>();
  private readonly cleanups: Array<() => void> = [];
  private palette: ScenePalette;
  private partsByDrawer: ReadonlyMap<string, number> = new Map();
  private focus: Focus | null = null;
  private focusCabinet: CabinetView | null = null;
  private hovered: Focus | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private pressedAt: { x: number; y: number } | null = null;
  private lastFrame = performance.now();
  private hasRendered = false;

  constructor(private readonly options: RoomSceneOptions) {
    const { canvas, model, reducedMotion } = options;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    // r186 removed PCFSoftShadowMap, which the renderer used; PCF is its replacement.
    this.renderer.shadowMap.type = PCFShadowMap;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = ORBIT_DAMPING;
    this.controls.minDistance = ORBIT_MIN_DISTANCE_MM;
    this.controls.maxDistance = ORBIT_MAX_DISTANCE_MM;
    this.controls.maxPolarAngle = ORBIT_MAX_POLAR_RAD;

    try {
      this.built = buildScene(this.scene, model);
      this.highlight = new Highlight(this.scene, this.built.unitBox);
      this.rig = new CameraRig(
        this.camera,
        this.controls,
        { min: new Vector3(...model.room.min), max: new Vector3(...model.room.max) },
        reducedMotion,
      );
      for (const drawer of this.built.drawers) {
        this.drawerByHit.set(drawer.hit, drawer);
        for (const cell of drawer.cells) this.cellByHit.set(cell.hit, { drawer, cell });
      }
      this.buildTags();
      // Sized now, not on the observer's first callback: the first flight is framed from the aspect.
      const host = canvas.parentElement ?? canvas;
      this.resize(host.clientWidth, host.clientHeight);
      this.palette = readPalette(options.themeSource);
      this.applyTheme();
      this.listen();

      const start = this.rig.start();
      this.camera.position.copy(start.position);
      this.controls.target.copy(start.target);
      this.controls.update();
      this.renderer.setAnimationLoop(this.frame);
    } catch (error) {
      // A scene that fails half-built must still give back what it took: the WebGL context above
      // all, which browsers ration.
      for (const cleanup of this.cleanups) cleanup();
      for (const { element } of this.tags.values()) element.remove();
      this.controls.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw error;
    }
  }

  /** Opens and flies to a drawer or cell; null flies back to the whole room. */
  focusOn(target: RoomPick | null, durationMs: number = FLIGHT_MS): void {
    const now = performance.now();
    const found = target === null ? null : this.resolve(target);
    if (found === null) {
      this.focus = null;
      this.setFocusCabinet(null);
      this.openOnly(null);
      this.rig.flyTo(this.rig.overview(), now, durationMs);
      return;
    }
    const sameDrawer = this.focus?.drawer === found.drawer;
    this.focus = found;
    this.setFocusCabinet(found.drawer.cabinet);
    this.openOnly(found.drawer);
    const { box, front, drawer } = found.drawer;
    const pose = this.rig.drawer(box, front, drawer.slide, found.cell?.box ?? null);
    this.rig.flyTo(pose, now, sameDrawer ? FLIGHT_REFOCUS_MS : durationMs);
  }

  /** Which cells hold stock, and the count for each drawer front. */
  setStock(stocked: ReadonlySet<string>, partsByDrawer: ReadonlyMap<string, number>): void {
    this.partsByDrawer = partsByDrawer;
    for (const [address, cell] of this.built.cellByAddress) {
      cell.tray.material = stocked.has(address) ? this.built.stocked : this.built.empty;
    }
    this.drawLabels();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    for (const cleanup of this.cleanups) cleanup();
    this.controls.dispose();
    for (const drawer of this.built.drawers) drawer.label.dispose();
    for (const { element } of this.tags.values()) element.remove();
    this.highlight.dispose();
    // Shared by many meshes, or by none when nothing is stocked: released here either way.
    for (const shared of [
      this.built.stocked,
      this.built.empty,
      this.built.hidden,
      this.built.unitBox,
    ]) {
      shared.dispose();
    }
    this.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer.dispose();
    // Browsers cap live WebGL contexts; give this one back now rather than at garbage collection.
    this.renderer.forceContextLoss();
  }

  private resolve(target: RoomPick): Focus | null {
    if (target.kind === 'drawer') {
      const drawer = this.built.drawers.find((view) => view.drawer.code === target.code);
      return drawer === undefined ? null : { drawer, cell: null };
    }
    const cell = this.built.cellByAddress.get(target.address);
    if (cell === undefined) return null;
    const drawer = this.built.drawers.find((view) => view.drawer.code === cell.cell.drawerCode);
    return drawer === undefined ? null : { drawer, cell };
  }

  private setFocusCabinet(cabinet: CabinetView | null): void {
    this.focusCabinet = cabinet;
    for (const view of this.built.cabinets) {
      view.targetOpacity = cabinet === null || view === cabinet ? 1 : UNFOCUSED_OPACITY;
    }
    this.built.decor.targetOpacity = cabinet === null ? 1 : 0;
  }

  private openOnly(drawer: DrawerView | null): void {
    for (const view of this.built.drawers) view.openTarget = view === drawer ? 1 : 0;
  }

  private buildTags(): void {
    for (const cabinet of this.built.cabinets) {
      const element = document.createElement('div');
      element.className = TAG_CLASS;
      const { name, movable } = cabinet.cabinet;
      element.textContent = movable ? t.room.cabinetOnWheels(name) : name;
      this.options.overlay.append(element);
      const { centre, size } = cabinet.box;
      const at = new Vector3(centre.x, centre.y + size.y / 2 + TAG_LIFT_MM, centre.z);
      at.addScaledVector(cabinet.front, Math.abs(size.dot(cabinet.front)) / 2);
      this.tags.set(cabinet, { element, at });
    }
    this.highlight.attachTag(this.options.overlay, TAG_CLASS);
  }

  private applyTheme(): void {
    const palette = this.palette;
    this.built.floor.color.copy(palette.floor);
    this.built.shellEdge.color.copy(palette.shellEdge);
    this.built.glass.color.copy(palette.glass);
    this.built.stocked.color.copy(palette.stocked);
    this.built.empty.color.copy(palette.empty);
    this.built.led.color.copy(palette.highlight);
    this.highlight.setColour(palette.highlight);
    this.drawLabels();
  }

  private drawLabels(): void {
    for (const drawer of this.built.drawers) {
      drawer.label.draw(this.palette, this.partsByDrawer.get(drawer.drawer.code) ?? 0);
    }
  }

  private listen(): void {
    const { canvas, themeSource } = this.options;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(type, handler);
      this.cleanups.push(() => canvas.removeEventListener(type, handler));
    };
    on('pointerdown', (event) => {
      // Only the primary button picks; the right button pans, and a still right-click is no pick.
      this.pressedAt =
        event.button === PRIMARY_BUTTON ? { x: event.clientX, y: event.clientY } : null;
    });
    on('pointerup', (event) => {
      const start = this.pressedAt;
      this.pressedAt = null;
      if (
        start === null ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_TOLERANCE_PX
      )
        return;
      const hit = this.pick(event.clientX, event.clientY);
      if (hit === null) return;
      this.options.onPick(
        hit.cell === null
          ? { kind: 'drawer', code: hit.drawer.drawer.code }
          : { kind: 'cell', address: hit.cell.cell.address },
      );
    });
    on('pointermove', (event) => {
      if (event.pointerType === 'mouse') this.pendingMove = { x: event.clientX, y: event.clientY };
    });
    on('pointerleave', () => {
      this.pendingMove = null;
      this.setHover(null);
    });

    const resize = new ResizeObserver(([entry]) => {
      if (entry !== undefined) this.resize(entry.contentRect.width, entry.contentRect.height);
    });
    resize.observe(canvas.parentElement ?? canvas);
    this.cleanups.push(() => resize.disconnect());

    const scheme = matchMedia(DARK_SCHEME_MEDIA);
    const retheme = () => {
      this.palette = readPalette(themeSource);
      this.applyTheme();
    };
    scheme.addEventListener('change', retheme);
    this.cleanups.push(() => scheme.removeEventListener('change', retheme));
  }

  private resize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private pick(clientX: number, clientY: number): Focus | null {
    const rect = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const open = this.focus?.drawer;
    if (open !== undefined && open.open > DRAWER_CELLS_VISIBLE_AT) {
      const [hit] = this.raycaster.intersectObjects(
        open.cells.map((cell) => cell.hit),
        false,
      );
      const found = hit === undefined ? undefined : this.cellByHit.get(hit.object);
      if (found !== undefined) return found;
    }
    const pool = this.built.drawers
      .filter(
        (view) =>
          this.focusCabinet === null ||
          view.cabinet === this.focusCabinet ||
          view.cabinet.opacity > PICKABLE_OPACITY,
      )
      .map((view) => view.hit);
    const [hit] = this.raycaster.intersectObjects(pool, false);
    const drawer = hit === undefined ? undefined : this.drawerByHit.get(hit.object);
    return drawer === undefined ? null : { drawer, cell: null };
  }

  private setHover(target: Focus | null): void {
    this.hovered = target;
    this.options.canvas.style.cursor = target === null ? '' : 'pointer';
  }

  private fade(group: FadeGroup, extra: DrawerView[], dt: number): void {
    const gap = group.targetOpacity - group.opacity;
    group.opacity =
      Math.abs(gap) > FADE_EPSILON && !this.options.reducedMotion
        ? group.opacity + gap * (1 - Math.exp(-dt * FADE_RATE))
        : group.targetOpacity;
    const faded = group.opacity < 1;
    const shown = group.opacity > HIDDEN_BELOW_OPACITY;
    for (const part of [...group.parts, ...extra.flatMap((drawer) => drawer.parts)]) {
      part.mesh.visible = shown;
      if (part.outline !== null) part.outline.visible = shown;
      const transparent = faded || part.isLabel;
      if (part.material.transparent !== transparent) {
        // r186 compiles an opaque material with alpha forced to 1, so flipping `transparent` needs
        // a new shader program; without this a faded cabinet would stay solid.
        part.material.transparent = transparent;
        part.material.needsUpdate = true;
      }
      part.material.opacity = group.opacity;
      part.material.depthWrite = !faded;
      if (part.outlineMaterial !== null)
        part.outlineMaterial.opacity = PART_EDGE_OPACITY * group.opacity;
    }
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(MAX_FRAME_SECONDS, (now - this.lastFrame) / MS_PER_SECOND);
    this.lastFrame = now;
    const { reducedMotion } = this.options;
    this.rig.step(now);

    for (const view of this.built.drawers) {
      if (view.open !== view.openTarget) {
        const rate = reducedMotion ? Number.POSITIVE_INFINITY : DRAWER_OPEN_RATE * dt;
        view.open =
          view.openTarget > view.open
            ? Math.min(view.openTarget, view.open + rate)
            : Math.max(view.openTarget, view.open - rate * DRAWER_CLOSE_FACTOR);
      }
      view.group.position
        .copy(view.front)
        .multiplyScalar(view.drawer.slide * smoothstep(view.open));
      const showCells = view.open > DRAWER_CELLS_VISIBLE_AT;
      for (const cell of view.cells) cell.tray.visible = showCells;
    }

    if (this.pendingMove !== null) {
      const next = this.pick(this.pendingMove.x, this.pendingMove.y);
      this.pendingMove = null;
      const key = (focus: Focus | null) => focus?.cell ?? focus?.drawer ?? null;
      if (key(next) !== key(this.hovered)) this.setHover(next);
    }

    this.controls.update();
    this.fade(this.built.decor, [], dt);
    for (const cabinet of this.built.cabinets) this.fade(cabinet, cabinet.drawers, dt);

    const { clientWidth: width, clientHeight: height } = this.options.canvas;
    for (const { element, at } of this.tags.values()) {
      element.hidden = this.focus !== null || !this.project(at, element, width, height);
    }
    const pulse = reducedMotion
      ? STEADY_PULSE
      : PULSE_FLOOR + PULSE_SWING * Math.sin((2 * Math.PI * now) / PULSE_PERIOD_MS);
    this.highlight.update({
      focus: this.focus,
      hovered: this.hovered,
      pulse,
      led: this.built.led,
      tagVisible: (point, element) =>
        !this.rig.isFlying && this.project(point, element, width, height),
    });

    this.renderer.render(this.scene, this.camera);
    if (!this.hasRendered) {
      this.hasRendered = true;
      this.options.onFirstFrame();
    }
  };

  /** Moves `element` over `point`'s place on screen; false when the point is off screen. */
  private project(point: Vector3, element: HTMLElement, width: number, height: number): boolean {
    const p = this.projected.copy(point).project(this.camera);
    const visible =
      Math.abs(p.z) < 1 && Math.abs(p.x) < TAG_VISIBLE_NDC && Math.abs(p.y) < TAG_VISIBLE_NDC;
    if (visible) {
      element.style.transform = `translate(${(p.x * 0.5 + 0.5) * width}px, ${(-p.y * 0.5 + 0.5) * height}px) translate(-50%, -100%)`;
    }
    return visible;
  }
}
