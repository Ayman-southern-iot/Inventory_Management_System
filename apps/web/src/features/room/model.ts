import { addressOf, type PanelDrawer, type PanelLayout } from '@/features/panel/layout';
import type { SceneAsset, SceneGeometry, ScenePart, Vec3 } from './scene/asset';

/**
 * The room as `/room` draws it: the 3D scene's boxes joined to the drawer plan's names and
 * addresses. The plan is the panel's own (`panelLayout`), so the address a cell is lit by here is
 * the same one the panel lights and the same one IMS stock is joined on (`address.ts`, OQ-P2).
 */

/** The scene and the plan disagree about a drawer or a cell. Thrown, never drawn around. */
export class RoomModelError extends Error {
  constructor(readonly problems: string[]) {
    super(`The room scene and the drawer plan disagree: ${problems.join('; ')}`);
    this.name = 'RoomModelError';
  }
}

/** A drawer or cell in the 3D view: what a click lands on, and what the camera is sent to. */
export type RoomPick = { kind: 'cell'; address: string } | { kind: 'drawer'; code: string };

/** What `/room` has selected: a 3D pick, or a `?cell=` naming no cell on the plan. */
export type RoomSelection = RoomPick | { kind: 'unknown'; value: string } | null;

/**
 * Where the 3D view should look for a selection. An open-shelf cell (LB, LR) and an unknown cell
 * have no place in the 3D model, so the room is shown whole; their contents are still listed.
 */
export function sceneFocusOf(
  selection: RoomSelection,
  model: Pick<RoomModel, 'cellByAddress' | 'drawerByCode'> | undefined,
): RoomPick | null {
  if (selection === null || selection.kind === 'unknown' || model === undefined) return null;
  if (selection.kind === 'drawer') return model.drawerByCode.has(selection.code) ? selection : null;
  return model.cellByAddress.has(selection.address) ? selection : null;
}

export interface RoomCell {
  /** Drawer code + cell code, e.g. `B2-2A-2D`. */
  address: string;
  /** As printed inside the drawer, e.g. `2A-2D`. */
  code: string;
  drawerCode: string;
  min: Vec3;
  max: Vec3;
}

export interface RoomDrawer {
  code: string;
  cabinetId: string;
  /** The plan's drawer: name, colour band, grid. */
  unit: PanelDrawer;
  /** 1 is the top drawer. */
  position: number;
  /** The drawer body's colour in the 3D model. */
  color: string;
  /** The cabinet's opening direction, and how far the drawer slides when open. */
  front: Vec3;
  slide: number;
  min: Vec3;
  max: Vec3;
  labelAt: Vec3;
  labelSize: [number, number];
  geo: SceneGeometry;
  cells: RoomCell[];
}

export interface RoomCabinet {
  id: string;
  name: string;
  movable: boolean;
  min: Vec3;
  max: Vec3;
  front: Vec3;
  slide: number;
  parts: ScenePart[];
  drawers: RoomDrawer[];
}

export interface RoomModel {
  room: { min: Vec3; max: Vec3 };
  shell: SceneGeometry;
  decor: ScenePart[];
  cabinets: RoomCabinet[];
  /** Every drawer, cabinet by cabinet, top to bottom. */
  drawers: RoomDrawer[];
  drawerByCode: ReadonlyMap<string, RoomDrawer>;
  /** The 148 drawer cells. The open shelves are not in the 3D model, so they are not here. */
  cellByAddress: ReadonlyMap<string, RoomCell>;
  /** The open shelves (LB, LR): searchable and listable, but nothing to draw. */
  shelves: PanelDrawer[];
}

export function buildRoomModel(asset: SceneAsset, layout: PanelLayout): RoomModel {
  const problems: string[] = [];
  if (asset.plan !== layout.version) {
    problems.push(
      `the scene was checked against plan ${asset.plan}, the panel ships ${layout.version}`,
    );
  }

  const cabinets: RoomCabinet[] = [];
  const seenCells = new Set<string>();
  for (const sceneCabinet of asset.cabinets) {
    const planCabinet = layout.cabinets.find((cabinet) => cabinet.id === sceneCabinet.id);
    if (planCabinet === undefined) {
      problems.push(`cabinet ${sceneCabinet.id} is not on the plan`);
      continue;
    }
    const drawers: RoomDrawer[] = [];
    sceneCabinet.drawers.forEach((sceneDrawer, index) => {
      const unit = planCabinet.drawers.find((drawer) => drawer.code === sceneDrawer.code);
      if (unit === undefined) {
        problems.push(`drawer ${sceneDrawer.code} is not in ${planCabinet.name} on the plan`);
        return;
      }
      const cells = sceneDrawer.cells.map((cell) => ({
        address: addressOf(unit.code, cell.cell),
        code: cell.cell,
        drawerCode: unit.code,
        min: cell.min,
        max: cell.max,
      }));
      for (const cell of cells) {
        if (!layout.cellByAddress.has(cell.address))
          problems.push(`cell ${cell.address} is not on the plan`);
        seenCells.add(cell.address);
      }
      drawers.push({
        code: unit.code,
        cabinetId: sceneCabinet.id,
        unit,
        position: index + 1,
        color: sceneDrawer.color,
        front: sceneCabinet.front,
        slide: sceneCabinet.slide,
        min: sceneDrawer.min,
        max: sceneDrawer.max,
        labelAt: sceneDrawer.labelAt,
        labelSize: sceneDrawer.labelSize,
        geo: sceneDrawer.geo,
        cells,
      });
    });
    cabinets.push({ ...sceneCabinet, name: planCabinet.name, drawers });
  }

  for (const cabinet of layout.cabinets) {
    for (const drawer of cabinet.drawers) {
      for (const cell of drawer.cells) {
        if (!seenCells.has(cell.address)) problems.push(`cell ${cell.address} is not in the scene`);
      }
    }
  }
  if (problems.length > 0) throw new RoomModelError(problems);

  const drawers = cabinets.flatMap((cabinet) => cabinet.drawers);
  return {
    room: asset.room,
    shell: asset.shell,
    decor: asset.decor,
    cabinets,
    drawers,
    drawerByCode: new Map(drawers.map((drawer) => [drawer.code, drawer])),
    cellByAddress: new Map(
      drawers.flatMap((drawer) => drawer.cells.map((cell) => [cell.address, cell] as const)),
    ),
    shelves: layout.shelves,
  };
}
