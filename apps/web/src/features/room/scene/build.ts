import {
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  type Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import {
  CELL_FILL_HEIGHT,
  CELL_INSET_MM,
  EMPTY_CELL_OPACITY,
  FLOOR_ROUGHNESS,
  FRONT_ROUGHNESS,
  GLASS_OPACITY,
  GLASS_ROUGHNESS,
  HEMISPHERE_INTENSITY,
  LED_RANGE_MM,
  PART_EDGE_ANGLE_DEG,
  PART_EDGE_DARKEN,
  PART_EDGE_OPACITY,
  PART_METALNESS,
  PART_ROUGHNESS,
  SHADOW_BIAS,
  SHADOW_EXTENT_MM,
  SHADOW_FAR_MM,
  SHADOW_MAP_SIZE,
  SHADOW_NEAR_MM,
  SHADOW_NORMAL_BIAS,
  SHELL_EDGE_ANGLE_DEG,
  SHELL_RENDER_ORDER,
  SKY_LIGHT_SRGB,
  GROUND_LIGHT_SRGB,
  SUN_LIGHT_SRGB,
  FLOOR_DROP_MM,
  SHELL_EDGE_OPACITY,
  SUN_INTENSITY,
  SUN_OFFSET_MM,
} from '../constants';
import type { RoomCabinet, RoomCell, RoomDrawer, RoomModel } from '../model';
import type { ScenePart } from './asset';
import type { Box } from './camera';
import { boxOf, decodeGeometry, vec } from './geometry';
import { DrawerLabel } from './labels';

/** A material that fades with its cabinet, and the outline drawn with it. */
export interface FadingPart {
  mesh: Mesh;
  material: Material;
  outline: LineSegments | null;
  outlineMaterial: LineBasicMaterial | null;
  /** Labels stay transparent at full opacity: their canvas has rounded, see-through corners. */
  isLabel: boolean;
}

export interface FadeGroup {
  parts: FadingPart[];
  opacity: number;
  targetOpacity: number;
}

export interface CellView {
  cell: RoomCell;
  box: Box;
  hit: Mesh;
  tray: Mesh;
}

/** A drawer fades with its cabinet, so it has parts but no opacity of its own. */
export interface DrawerView {
  drawer: RoomDrawer;
  parts: FadingPart[];
  cabinet: CabinetView;
  group: Group;
  box: Box;
  /** The cells' combined box: what glows when a drawer is selected without a cell. */
  cellBounds: Box;
  front: Vector3;
  open: number;
  openTarget: number;
  label: DrawerLabel;
  hit: Mesh;
  cells: CellView[];
}

export interface CabinetView extends FadeGroup {
  cabinet: RoomCabinet;
  box: Box;
  front: Vector3;
  drawers: DrawerView[];
}

export interface BuiltScene {
  /** One unit box, scaled per use: every hit box, tray and highlight shares it. */
  unitBox: BoxGeometry;
  /** Hit boxes are raycast against but never drawn. */
  hidden: MeshBasicMaterial;
  floor: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  shellEdge: LineBasicMaterial;
  sun: DirectionalLight;
  led: PointLight;
  /** Shared by every cell tray: one for stocked, one for empty. */
  stocked: MeshStandardMaterial;
  empty: MeshBasicMaterial;
  decor: FadeGroup;
  cabinets: CabinetView[];
  drawers: DrawerView[];
  cellByAddress: Map<string, CellView>;
}

function partMesh(part: ScenePart, parent: Scene | Group, list: FadingPart[]): void {
  const geometry = decodeGeometry(part.geo);
  const colour = new Color(part.color);
  const material = new MeshStandardMaterial({
    color: colour,
    roughness: part.role === 'front' ? FRONT_ROUGHNESS : PART_ROUGHNESS,
    metalness: PART_METALNESS,
  });
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  let outline: LineSegments | null = null;
  let outlineMaterial: LineBasicMaterial | null = null;
  if (part.edges !== false) {
    outlineMaterial = new LineBasicMaterial({
      color: colour.clone().multiplyScalar(PART_EDGE_DARKEN),
      transparent: true,
      opacity: PART_EDGE_OPACITY,
    });
    outline = new LineSegments(new EdgesGeometry(geometry, PART_EDGE_ANGLE_DEG), outlineMaterial);
    parent.add(outline);
  }
  list.push({ mesh, material, outline, outlineMaterial, isLabel: false });
}

function hitBox(box: Box, parent: Group, built: BuiltScene): Mesh {
  const hit = new Mesh(built.unitBox, built.hidden);
  hit.position.copy(box.centre);
  hit.scale.copy(box.size);
  parent.add(hit);
  return hit;
}

function buildDrawer(
  drawer: RoomDrawer,
  cabinet: CabinetView,
  scene: Scene,
  built: BuiltScene,
): DrawerView {
  const group = new Group();
  scene.add(group);
  const parts: FadingPart[] = [];
  partMesh({ color: drawer.color, geo: drawer.geo }, group, parts);

  const label = new DrawerLabel(drawer.code, drawer.unit.name, drawer.unit.bandColour);
  const labelMaterial = new MeshBasicMaterial({ map: label.texture, transparent: true });
  const [labelWidth, labelHeight] = drawer.labelSize;
  const plane = new Mesh(new PlaneGeometry(labelWidth, labelHeight), labelMaterial);
  plane.position.copy(vec(drawer.labelAt));
  plane.rotation.y = Math.atan2(drawer.front[0], drawer.front[2]);
  group.add(plane);
  parts.push({
    mesh: plane,
    material: labelMaterial,
    outline: null,
    outlineMaterial: null,
    isLabel: true,
  });

  const box = boxOf(drawer.min, drawer.max);
  const low = drawer.cells.map((cell) => cell.min);
  const high = drawer.cells.map((cell) => cell.max);
  const corner = (
    corners: Array<[number, number, number]>,
    pick: (...values: number[]) => number,
  ) => [0, 1, 2].map((axis) => pick(...corners.map((c) => c[axis]!))) as [number, number, number];
  const view: DrawerView = {
    drawer,
    cabinet,
    group,
    box,
    cellBounds: boxOf(corner(low, Math.min), corner(high, Math.max)),
    front: vec(drawer.front),
    open: 0,
    openTarget: 0,
    label,
    hit: hitBox(box, group, built),
    cells: [],
    parts,
  };
  for (const cell of drawer.cells) {
    const cellBox = boxOf(cell.min, cell.max);
    const tray = new Mesh(built.unitBox, built.empty);
    const height = cellBox.size.y * CELL_FILL_HEIGHT;
    tray.scale.set(
      Math.max(1, cellBox.size.x - CELL_INSET_MM),
      height,
      Math.max(1, cellBox.size.z - CELL_INSET_MM),
    );
    tray.position.set(
      cellBox.centre.x,
      cellBox.centre.y - cellBox.size.y / 2 + height / 2,
      cellBox.centre.z,
    );
    tray.visible = false;
    group.add(tray);
    const cellView = { cell, box: cellBox, hit: hitBox(cellBox, group, built), tray };
    view.cells.push(cellView);
    built.cellByAddress.set(cell.address, cellView);
  }
  return view;
}

/** Everything static in the room, built once from the model. */
export function buildScene(scene: Scene, model: RoomModel): BuiltScene {
  const roomMin = vec(model.room.min);
  const roomMax = vec(model.room.max);
  const centre = roomMin.clone().add(roomMax).multiplyScalar(0.5);
  const size = roomMax.clone().sub(roomMin);

  const srgb = ([red, green, blue]: readonly [number, number, number]) =>
    new Color().setRGB(red, green, blue, SRGBColorSpace);
  scene.add(
    new HemisphereLight(srgb(SKY_LIGHT_SRGB), srgb(GROUND_LIGHT_SRGB), HEMISPHERE_INTENSITY),
  );
  const sun = new DirectionalLight(srgb(SUN_LIGHT_SRGB), SUN_INTENSITY);
  sun.position.copy(centre).add(new Vector3(...SUN_OFFSET_MM));
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_EXTENT_MM,
    right: SHADOW_EXTENT_MM,
    top: SHADOW_EXTENT_MM,
    bottom: -SHADOW_EXTENT_MM,
    near: SHADOW_NEAR_MM,
    far: SHADOW_FAR_MM,
  });
  sun.shadow.bias = SHADOW_BIAS;
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
  scene.add(sun, sun.target);
  // Decay 0: see LED_RANGE_MM. Off until something is selected.
  const led = new PointLight(srgb(SKY_LIGHT_SRGB), 0, LED_RANGE_MM, 0);
  scene.add(led);

  const floor = new MeshStandardMaterial({ roughness: FLOOR_ROUGHNESS, metalness: 0 });
  const floorMesh = new Mesh(new PlaneGeometry(size.x, size.z), floor);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(centre.x, roomMin.y - FLOOR_DROP_MM, centre.z);
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  const shellGeometry = decodeGeometry(model.shell);
  const glass = new MeshStandardMaterial({
    transparent: true,
    opacity: GLASS_OPACITY,
    depthWrite: false,
    side: DoubleSide,
    roughness: GLASS_ROUGHNESS,
  });
  const shell = new Mesh(shellGeometry, glass);
  // After the opaque scene and before the highlight, as the renderer drew it.
  shell.renderOrder = SHELL_RENDER_ORDER;
  scene.add(shell);
  const shellEdge = new LineBasicMaterial({ transparent: true, opacity: SHELL_EDGE_OPACITY });
  scene.add(new LineSegments(new EdgesGeometry(shellGeometry, SHELL_EDGE_ANGLE_DEG), shellEdge));

  const built: BuiltScene = {
    unitBox: new BoxGeometry(1, 1, 1),
    hidden: new MeshBasicMaterial({ visible: false }),
    floor,
    glass,
    shellEdge,
    sun,
    led,
    stocked: new MeshStandardMaterial({ roughness: PART_ROUGHNESS, metalness: PART_METALNESS }),
    empty: new MeshBasicMaterial({
      transparent: true,
      opacity: EMPTY_CELL_OPACITY,
      depthWrite: false,
    }),
    decor: { parts: [], opacity: 1, targetOpacity: 1 },
    cabinets: [],
    drawers: [],
    cellByAddress: new Map(),
  };
  for (const part of model.decor) partMesh(part, scene, built.decor.parts);

  for (const cabinet of model.cabinets) {
    const view: CabinetView = {
      cabinet,
      box: boxOf(cabinet.min, cabinet.max),
      front: vec(cabinet.front),
      drawers: [],
      parts: [],
      opacity: 1,
      targetOpacity: 1,
    };
    for (const part of cabinet.parts) partMesh(part, scene, view.parts);
    for (const drawer of cabinet.drawers) {
      const drawerView = buildDrawer(drawer, view, scene, built);
      view.drawers.push(drawerView);
      built.drawers.push(drawerView);
    }
    built.cabinets.push(view);
  }
  return built;
}
