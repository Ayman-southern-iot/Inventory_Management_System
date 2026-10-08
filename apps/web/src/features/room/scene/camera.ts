import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  FLIGHT_MAX_LIFT_MM,
  FLIGHT_MS,
  FRAMING,
  ROOM_CEILING_MARGIN_MM,
  ROOM_FLOOR_MARGIN_MM,
  ROOM_WALL_MARGIN_MM,
} from '../constants';

export interface Pose {
  position: Vector3;
  target: Vector3;
}

/** The parts of a cabinet, drawer or cell the framing needs, in world mm. */
export interface Box {
  centre: Vector3;
  size: Vector3;
}

interface Flight {
  from: Pose;
  to: Pose;
  lift: number;
  startedAt: number;
  durationMs: number;
}

const UP = new Vector3(0, 1, 0);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Width of a box seen face-on from `front` (the depth axis dropped). */
const faceWidth = (size: Vector3, front: Vector3) =>
  Math.abs(size.x * front.z) + Math.abs(size.z * front.x);

/**
 * Where the camera looks from for the overview and for an open drawer, and the eased flight
 * between them. The framing is the 3D renderer's; the view's own aspect replaces its allowance
 * for panels drawn over the canvas, because here the side list sits beside it.
 */
export class CameraRig {
  private flight: Flight | null = null;
  private readonly roomCentre: Vector3;
  private readonly roomSize: Vector3;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly room: { min: Vector3; max: Vector3 },
    private readonly reducedMotion: boolean,
  ) {
    this.roomCentre = room.min.clone().add(room.max).multiplyScalar(0.5);
    this.roomSize = room.max.clone().sub(room.min);
  }

  get isFlying(): boolean {
    return this.flight !== null;
  }

  /** Camera distance at which a `width` × `height` subject fills the view. */
  private fitDistance(width: number, height: number): number {
    const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
    const aspect = Math.max(FRAMING.minFitAspect, this.camera.aspect);
    return Math.max(height / 2 / Math.tan(halfFov), width / 2 / Math.tan(halfFov) / aspect);
  }

  private clampInRoom(point: Vector3): Vector3 {
    const { min, max } = this.room;
    point.x = MathUtils.clamp(point.x, min.x + ROOM_WALL_MARGIN_MM, max.x - ROOM_WALL_MARGIN_MM);
    point.z = MathUtils.clamp(point.z, min.z + ROOM_WALL_MARGIN_MM, max.z - ROOM_WALL_MARGIN_MM);
    point.y = MathUtils.clamp(
      point.y,
      min.y + ROOM_FLOOR_MARGIN_MM,
      max.y - ROOM_CEILING_MARGIN_MM,
    );
    return point;
  }

  /** Sideways from `front`, toward the middle of the room, so a view never backs into a wall. */
  private sideOf(front: Vector3, centre: Vector3): Vector3 {
    const side = new Vector3().crossVectors(UP, front).normalize();
    return side.multiplyScalar(Math.sign(side.dot(this.roomCentre.clone().sub(centre))) || 1);
  }

  overview(): Pose {
    const view = FRAMING.overview;
    const radius = this.roomSize.length() / 2;
    const across = radius * (this.camera.aspect < 1 ? view.portraitRadii : view.radii);
    const distance = this.fitDistance(across, radius * view.heightRadii);
    const target = new Vector3(
      this.roomCentre.x * view.targetXShare,
      this.roomSize.y * view.targetYShare,
      this.roomCentre.z,
    );
    const direction = new Vector3(...view.direction).normalize();
    return { position: target.clone().addScaledVector(direction, distance), target };
  }

  /** Far out above the room: where the first flight starts. */
  start(): Pose {
    const pose = this.overview();
    const [x, y, z] = FRAMING.overview.startOffsetShare;
    const offset = new Vector3(this.roomSize.x * x, this.roomSize.y * y, this.roomSize.z * z);
    return { position: pose.position.add(offset), target: pose.target };
  }

  /** Looking down into a drawer slid fully open, aimed toward `cell` when one is chosen. */
  drawer(box: Box, front: Vector3, slide: number, cell: Box | null): Pose {
    const view = FRAMING.drawer;
    const open = front.clone().multiplyScalar(slide);
    const target = box.centre.clone().add(open);
    target.y = box.centre.y + box.size.y / 2 - view.lookBelowTopMm;
    if (cell !== null) {
      const cellCentre = cell.centre.clone().add(open);
      cellCentre.y = target.y;
      target.lerp(cellCentre, view.cellPull);
    }
    const width = faceWidth(box.size, front);
    const distance = MathUtils.clamp(
      this.fitDistance(width * view.widthPad, width * view.heightShare),
      view.minMm,
      view.maxMm,
    );
    const position = target
      .clone()
      .addScaledVector(front, distance * view.frontShare)
      .addScaledVector(UP, distance * view.upShare)
      .addScaledVector(this.sideOf(front, box.centre), distance * view.sideShare);
    return { position: this.clampInRoom(position), target };
  }

  /** Jumps there when motion is reduced or `durationMs` is 0; otherwise arcs there. */
  flyTo(pose: Pose, now: number, durationMs: number = FLIGHT_MS): void {
    if (this.reducedMotion || durationMs <= 0) {
      this.flight = null;
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.enabled = true;
      this.controls.update();
      return;
    }
    const from = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    const lift = Math.min(
      FLIGHT_MAX_LIFT_MM,
      from.position.distanceTo(pose.position) * FRAMING.liftShare,
    );
    // Orbiting mid-flight would fight the tween; the controls come back when it lands.
    this.controls.enabled = false;
    this.flight = { from, to: pose, lift, startedAt: now, durationMs };
  }

  /** Advances a flight; call once per frame. */
  step(now: number): void {
    if (this.flight === null) return;
    const { from, to, lift, startedAt, durationMs } = this.flight;
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = easeInOutCubic(progress);
    this.camera.position.lerpVectors(from.position, to.position, eased);
    this.camera.position.y += Math.sin(Math.PI * eased) * lift;
    this.controls.target.lerpVectors(from.target, to.target, eased);
    if (progress >= 1) {
      this.flight = null;
      this.controls.enabled = true;
    }
  }
}
