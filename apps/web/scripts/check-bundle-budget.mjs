#!/usr/bin/env node
/**
 * Bundle budget, run in CI: builds the web app in memory and fails when
 *   - the main JS (entry chunk + its static imports) grows past its baseline + allowance, or
 *   - what `/panel` loads (the main JS + the panel chunk + its static imports) does, or
 *   - any module of a forbidden package (three.js) is in what `/panel` loads.
 * The kiosk runs `/panel` all day on a small board; the 3D room view must never cost it a byte
 * of three.js. Budgets and baselines: ../bundle-budget.json.
 *
 *   pnpm --filter @ims/web check:bundle [--budget <file>]
 *
 * It reads each chunk's module list from the build itself rather than searching the minified
 * code for names, so a renamed export cannot hide three.js from it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `--budget <file>` checks against another budget: how the check itself is shown to fail.
const budgetFlag = process.argv.indexOf('--budget');
const budgetPath =
  budgetFlag > 0 ? resolve(process.argv[budgetFlag + 1]) : resolve(WEB, 'bundle-budget.json');
const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));

const [output] = [await build({ root: WEB, logLevel: 'silent', build: { write: false } })].flat();
const chunks = new Map(
  output.output.filter((item) => item.type === 'chunk').map((chunk) => [chunk.fileName, chunk]),
);

/**
 * A chunk and every chunk it imports, transitively. Static imports only by default: those load up
 * front. With `lazy`, also what it may import later, stopping at `known` chunks so the main
 * bundle's own lazy routes (the 3D room among them) are not counted against the panel.
 */
function closure(start, { lazy = false, known = new Set() } = {}) {
  const seen = new Set();
  const visit = (fileName) => {
    if (seen.has(fileName) || known.has(fileName)) return;
    seen.add(fileName);
    const chunk = chunks.get(fileName);
    for (const imported of chunk?.imports ?? []) visit(imported);
    if (lazy) for (const imported of chunk?.dynamicImports ?? []) visit(imported);
  };
  visit(start.fileName);
  return [...seen].map((fileName) => chunks.get(fileName));
}

const gzipBytes = (list) =>
  list.reduce((sum, chunk) => sum + gzipSync(chunk.code, { level: budget.gzipLevel }).length, 0);

const entry = [...chunks.values()].find((chunk) => chunk.isEntry);
const panelPath = resolve(WEB, budget.panel.entry);
const panel = [...chunks.values()].find((chunk) => chunk.facadeModuleId === panelPath);
if (entry === undefined || panel === undefined) {
  console.error(`bundle budget: could not find the entry chunk or ${budget.panel.entry}`);
  process.exit(1);
}

const mainChunks = closure(entry);
const panelChunks = [...new Set([...mainChunks, ...closure(panel)])];
// Anything the panel page could lazy-load later counts too: it would still reach the kiosk.
const panelMayLoad = [
  ...new Set([
    ...panelChunks,
    ...closure(panel, { lazy: true, known: new Set(mainChunks.map((c) => c.fileName)) }),
  ]),
];
const packageDir = (name) => `${sep}node_modules${sep}${name}${sep}`;
const forbidden = budget.panel.forbiddenPackages.flatMap((name) =>
  panelMayLoad.flatMap((chunk) =>
    chunk.moduleIds
      .filter((id) => id.includes(packageDir(name)))
      .map((id) => `${chunk.fileName}: ${id}`),
  ),
);

const rows = [
  ['main JS', gzipBytes(mainChunks), budget.main],
  ['/panel JS', gzipBytes(panelChunks), budget.panel],
].map(([name, bytes, { baselineGzipBytes, allowanceBytes }]) => ({
  name,
  bytes,
  baseline: baselineGzipBytes,
  limit: baselineGzipBytes + allowanceBytes,
}));

for (const row of rows) {
  const delta = row.bytes - row.baseline;
  process.stdout.write(
    `${row.bytes > row.limit ? 'FAIL' : 'ok  '} ${row.name.padEnd(10)} ${row.bytes} B gzip  ` +
      `(baseline ${row.baseline}, ${delta >= 0 ? '+' : ''}${delta}, limit ${row.limit})\n`,
  );
}
process.stdout.write(
  `${forbidden.length > 0 ? 'FAIL' : 'ok  '} /panel JS has no ${budget.panel.forbiddenPackages.join(', ')} module\n`,
);
for (const line of forbidden) process.stdout.write(`       ${line}\n`);
process.stdout.write(
  `     /panel loads: ${panelChunks.map((chunk) => chunk.fileName).join(', ')}\n`,
);

if (forbidden.length > 0 || rows.some((row) => row.bytes > row.limit)) process.exit(1);
