#!/usr/bin/env node
/**
 * Extracts the room scene `/room` draws from the 3D renderer's preview page.
 *
 *   node scripts/room-scene/extract-scene.mjs <renderer.html> [--out <scene.json>] [--check]
 *
 * The page embeds the whole scene as `<script type="application/json" id="scene-data">`. This
 * keeps the geometry only — meshes, boxes and the cabinets' opening directions — and drops every
 * line of text, because IMS is the only source of what is stored where (the plan supplies names
 * and addresses, IMS the stock). Before writing anything it checks the scene against the drawer
 * plan the panel already ships (`apps/web/src/features/panel/layout/drawer-plan-v4.json`): the same
 * drawers, the same cells, the same boxes. Any difference stops it, so a cabinet change cannot
 * reach `/room` with the plan and the model disagreeing about where a cell is.
 *
 * `--check` writes nothing and fails if the committed file differs from what would be written.
 * See README.md next to this file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAN_PATH = resolve(REPO, 'apps/web/src/features/panel/layout/drawer-plan-v4.json');
const DEFAULT_OUT = resolve(REPO, 'apps/web/src/features/room/assets/scene-v4.json');
/** Bumped when the shape below changes; `features/room/scene/asset.ts` refuses any other. */
const FORMAT = 1;
/**
 * The renderer colours drawer bodies in code rather than in its scene data: the roller's darker
 * than the cabinets'. Carried into the asset so `/room` has no colour literals of its own.
 */
const DRAWER_BODY_COLOUR = { cabinet: '#D9B57C', roller: '#8F6B3E' };
const SCENE_TAG = /<script type="application\/json" id="scene-data">([\s\S]*?)<\/script>/;

function usage(message) {
  console.error(
    `${message}\nusage: extract-scene.mjs <renderer.html> [--out <scene.json>] [--check]`,
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = { html: null, out: DEFAULT_OUT, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--out') args.out = resolve(argv[(i += 1)] ?? usage('--out needs a path'));
    else if (args.html === null) args.html = resolve(arg);
    else usage(`unexpected argument: ${arg}`);
  }
  if (args.html === null) usage('the renderer page is required');
  return args;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const geo = (g) => (g.i32 ? { p: g.p, n: g.n, i: g.i, i32: true } : { p: g.p, n: g.n, i: g.i });
const part = (p) => ({
  ...(p.role === undefined ? {} : { role: p.role }),
  color: p.color,
  ...(p.edges === false ? { edges: false } : {}),
  geo: geo(p.geo),
});

/** Every way the scene and the plan disagree, one line each. Empty means they agree. */
function compare(scene, plan) {
  const problems = [];
  const sceneCabinets = new Map(scene.cabinets.map((cabinet) => [cabinet.id, cabinet]));
  if (
    !same(
      [...sceneCabinets.keys()],
      plan.cabinets.map((cabinet) => cabinet.id),
    )
  ) {
    problems.push(
      `cabinets: scene ${[...sceneCabinets.keys()]} vs plan ${plan.cabinets.map((c) => c.id)}`,
    );
  }
  for (const planCabinet of plan.cabinets) {
    const cabinet = sceneCabinets.get(planCabinet.id);
    if (cabinet === undefined) continue;
    const drawers = new Map(cabinet.drawers.map((drawer) => [drawer.code, drawer]));
    if (
      !same(
        [...drawers.keys()],
        planCabinet.drawers.map((drawer) => drawer.code),
      )
    ) {
      problems.push(
        `cabinet ${planCabinet.id}: drawers ${[...drawers.keys()]} vs plan ${planCabinet.drawers.map((d) => d.code)}`,
      );
    }
    for (const planDrawer of planCabinet.drawers) {
      const drawer = drawers.get(planDrawer.code);
      if (drawer === undefined) continue;
      for (const key of ['min', 'max', 'front', 'labelAt', 'labelSize', 'rows', 'cols']) {
        if (!same(drawer[key], planDrawer[key]))
          problems.push(`drawer ${planDrawer.code}: ${key} differs`);
      }
      const cells = new Map(drawer.cells.map((cell) => [cell.cell, cell]));
      if (!same([...cells.keys()].sort(), planDrawer.cells.map((cell) => cell.cell).sort())) {
        problems.push(`drawer ${planDrawer.code}: cells differ`);
      }
      for (const planCell of planDrawer.cells) {
        const cell = cells.get(planCell.cell);
        if (cell === undefined) continue;
        for (const key of ['min', 'max', 'r', 'r1', 'c0', 'c1']) {
          if (!same(cell[key], planCell[key])) {
            problems.push(`cell ${planDrawer.code}-${planCell.cell}: ${key} differs`);
          }
        }
      }
    }
  }
  if ((scene.unplaced ?? []).length > 0) {
    problems.push(`unplaced drawers: ${scene.unplaced.map((drawer) => drawer.code)}`);
  }
  const zones = (list) =>
    list.map((zone) => `${zone.code}:${zone.cells.map((c) => c.cell)}`).sort();
  if (!same(zones(scene.zones ?? []), zones(plan.zones))) problems.push('open-shelf zones differ');
  return problems;
}

function slim(scene, plan) {
  return {
    format: FORMAT,
    plan: plan.version,
    room: { min: scene.room.min, max: scene.room.max },
    shell: geo(scene.shell),
    cabinets: scene.cabinets.map((cabinet) => ({
      id: cabinet.id,
      movable: cabinet.movable === true,
      min: cabinet.min,
      max: cabinet.max,
      front: cabinet.front,
      slide: cabinet.slide,
      parts: cabinet.parts.map(part),
      drawers: cabinet.drawers.map((drawer) => ({
        code: drawer.code,
        color: cabinet.movable === true ? DRAWER_BODY_COLOUR.roller : DRAWER_BODY_COLOUR.cabinet,
        min: drawer.min,
        max: drawer.max,
        labelAt: drawer.labelAt,
        labelSize: drawer.labelSize,
        geo: geo(drawer.geo),
        cells: drawer.cells.map((cell) => ({ cell: cell.cell, min: cell.min, max: cell.max })),
      })),
    })),
    decor: (scene.decor ?? []).map(part),
  };
}

const args = parseArgs(process.argv.slice(2));
const match = SCENE_TAG.exec(readFileSync(args.html, 'utf8'));
if (match === null) usage(`no <script id="scene-data"> in ${args.html}`);
const scene = JSON.parse(match[1]);
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));

const problems = compare(scene, plan);
if (problems.length > 0) {
  console.error(`The scene and the drawer plan disagree (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const output = `${JSON.stringify(slim(scene, plan))}\n`;
if (args.check) {
  let committed = '';
  try {
    committed = readFileSync(args.out, 'utf8');
  } catch {
    // Missing counts as different.
  }
  if (committed !== output) {
    console.error(`${args.out} is not what ${args.html} produces. Re-run without --check.`);
    process.exit(1);
  }
  process.stdout.write(`ok: ${args.out} matches\n`);
} else {
  writeFileSync(args.out, output);
  const cells = scene.cabinets.flatMap((cabinet) => cabinet.drawers).flatMap((d) => d.cells).length;
  process.stdout.write(
    `wrote ${args.out}: ${output.length} bytes, ${cells} cells, plan ${plan.version}\n`,
  );
}
