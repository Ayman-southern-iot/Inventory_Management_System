#!/usr/bin/env node
/**
 * Local-only browser check of the drawer-light signal, Phase 13 (not in CI). Drives a production
 * build of the web app against a dev or throwaway API, never production: it refuses any address
 * that is not this machine.
 *
 *   <admin password on stdin> | node scripts/locate-e2e/locate-e2e.mjs --admin-email <email> [options]
 *
 * The admin's password is read from stdin, so it is never in the process list, shell history or
 * any log.
 *
 * Both addresses must be this machine, but a loopback port tunnelled to production would pass that
 * check: never point `--api` at one. The seed adds rooms, cells, products and stock movements, and
 * the ledger keeps every movement for ever.
 *
 * Options:
 *   --web <url>          the web app, e.g. `vite preview` proxying /api   [http://127.0.0.1:4173]
 *   --api <url>          the API the seed writes to, called directly     [http://127.0.0.1:3010/api/v1]
 *   --admin-email <e>    an admin on that API, to seed with              (required)
 *   --out <dir>          where results.json goes                         [playwright-shots/locate]
 *   --playwright <path>  a Playwright package, if not resolvable by name
 *
 * Seeds, idempotently, through the API: Cabinet B / B2 with cells 2A-2D and 2G, a part with stock
 * in 2A-2D, a part whose last unit has left 2G, and a GENERAL account to browse as (its password
 * reset to a fresh random value each run). Then checks:
 *
 *   - `/inventory`: typing "STS3215" posts exactly one `POST /locate` once typing rests, naming
 *     that part — not one per keystroke;
 *   - `/panel`: the same search posts exactly one;
 *   - the API's latest event lights B2 green at 2A-2D and names no product (K2);
 *   - a locate for the part that ran out lights B2 red at 2G (the ledger fallback).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const { chromium } = require(flag('playwright', 'playwright'));

const WEB = flag('web', 'http://127.0.0.1:4173');
const API = flag('api', 'http://127.0.0.1:3010/api/v1');
const OUT = resolve(flag('out', 'playwright-shots/locate'));
const ADMIN = { email: flag('admin-email', ''), password: readFileSync(0, 'utf8').trim() };
const BROWSER = { email: 'locate-e2e@ims.local', fullName: 'Locate Check Account' };
const CABINET = { room: 'Cabinet B', zone: 'B2' };
const IN_STOCK = { name: 'STS3215 serial bus servo (locate e2e)', cell: '2A-2D', quantity: 14 };
const RUN_OUT = { name: 'Shaft collar 8 mm (locate e2e)', cell: '2G' };
const SEARCH = 'STS3215';
/** How long to wait for the first locate after typing: past both screens' settle delays. */
const FIRST_LOCATE_MS = 5_000;
/** After the first locate, how long nothing else may be posted for the check to pass. */
const QUIET_MS = 2_500;
const LOCATE_PATH = '/api/v1/locate';

// `URL.hostname` keeps the brackets on an IPv6 literal.
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
for (const address of [WEB, API]) {
  if (!LOOPBACK.includes(new URL(address).hostname)) {
    console.error(`refusing ${address}: this check runs against a local build and a dev API only`);
    process.exit(2);
  }
}
if (!ADMIN.email || !ADMIN.password) {
  console.error('--admin-email is required, and the password on stdin');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const results = { web: WEB, api: API, checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}\n`,
  );
};

async function call(method, path, token, body, extra = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return text === '' ? null : JSON.parse(text);
}

/** The cell, created if the API does not have it yet. Returns its compartment id. */
async function ensureCell(token, code) {
  const rooms = await call('GET', '/locations/rooms', token);
  let room = rooms.find((item) => item.name === CABINET.room);
  if (room === undefined) {
    room = { ...(await call('POST', '/locations/rooms', token, { name: CABINET.room })), zones: [] };
  }
  let zone = room.zones.find((item) => item.name === CABINET.zone);
  if (zone === undefined) {
    zone = {
      ...(await call('POST', '/locations/zones', token, { name: CABINET.zone, roomId: room.id })),
      compartments: [],
    };
  }
  const found = zone.compartments.find((item) => item.code === code);
  if (found !== undefined) return found.id;
  return (await call('POST', '/locations/compartments', token, { zoneId: zone.id, code })).id;
}

async function ensureProduct(token, name, categoryId) {
  const catalogue = await call('GET', '/catalogue', token);
  const found = catalogue.products.find((item) => item.name === name);
  return found ?? call('POST', '/products', token, { name, unit: 'pcs', categoryId });
}

async function seed() {
  const { accessToken: token } = await call('POST', '/auth/login', null, ADMIN);
  const categories = await call('GET', '/categories', token);
  const category =
    categories.find((item) => item.name === 'Locate e2e') ??
    (await call('POST', '/categories', token, { name: 'Locate e2e', isTrackable: true }));

  const stockedCell = await ensureCell(token, IN_STOCK.cell);
  const stocked = await ensureProduct(token, IN_STOCK.name, category.id);
  if (!(stocked.locations ?? []).some((at) => at.compartmentId === stockedCell && at.quantity > 0)) {
    await call(
      'POST',
      '/stock/receive',
      token,
      { productId: stocked.id, compartmentId: stockedCell, quantity: IN_STOCK.quantity, note: 'locate e2e seed' },
      { 'Idempotency-Key': randomUUID() },
    );
  }

  // Received and taken back out, so it has no placement and only the ledger knows its cell.
  const emptyCell = await ensureCell(token, RUN_OUT.cell);
  const runOut = await ensureProduct(token, RUN_OUT.name, category.id);
  if ((runOut.locations ?? []).length === 0 && (runOut.stock?.total ?? 0) === 0) {
    await call(
      'POST',
      '/stock/receive',
      token,
      { productId: runOut.id, compartmentId: emptyCell, quantity: 1, note: 'locate e2e seed' },
      { 'Idempotency-Key': randomUUID() },
    );
  }
  const now = (await call('GET', '/catalogue', token)).products.find((item) => item.id === runOut.id);
  for (const at of now?.locations ?? []) {
    await call('POST', '/stock/adjust', token, {
      productId: runOut.id,
      compartmentId: at.compartmentId,
      delta: -at.quantity,
      reason: 'locate e2e: run the part out',
    });
  }

  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const users = await call('GET', `/admin/users?search=${encodeURIComponent(BROWSER.email)}`, token);
  const existing = users.items.find((user) => user.email === BROWSER.email);
  if (existing === undefined) {
    await call('POST', '/admin/users', token, {
      ...BROWSER,
      designation: 'Browser check',
      roles: ['GENERAL'],
      password,
      mustChangePassword: false,
    });
  } else {
    await call('POST', `/admin/users/${existing.id}/password`, token, {
      newPassword: password,
      mustChangePassword: false,
    });
  }
  return { token, password, stockedId: stocked.id, runOutId: runOut.id };
}

/** Signs in through the web app's own form; a refused sign-in stops the run with its status. */
async function signIn(page, password) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(BROWSER.email);
  await page.getByLabel(/password/i).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((answer) => new URL(answer.url()).pathname === '/api/v1/auth/login'),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
  if (!response.ok()) {
    throw new Error(`sign-in through ${WEB} answered ${response.status()}: is it proxying to ${API}?`);
  }
  await page.waitForURL((url) => url.pathname !== '/login');
}

/** Every `POST /locate` the page sends from now on, with its body and answer. */
function recordLocates(page) {
  const seen = [];
  page.on('response', async (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || new URL(response.url()).pathname !== LOCATE_PATH) return;
    seen.push({
      body: request.postDataJSON(),
      status: response.status(),
      answer: await response.json().catch(() => null),
    });
  });
  return seen;
}

/** Types like a person, then waits for the first locate and a quiet spell after it. */
async function typeAndSettle(page, field, seen) {
  const before = seen.length;
  await field.click();
  await page.keyboard.type(SEARCH, { delay: 120 });
  const deadline = Date.now() + FIRST_LOCATE_MS;
  while (seen.length === before && Date.now() < deadline) await page.waitForTimeout(100);
  await page.waitForTimeout(QUIET_MS);
  return seen.slice(before);
}

const browser = await chromium.launch();
try {
  const { token, password, stockedId, runOutId } = await seed();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const seen = recordLocates(page);
  await signIn(page, password);

  await page.goto(`${WEB}/inventory`);
  const fromInventory = await typeAndSettle(page, page.getByLabel('Search', { exact: true }), seen);
  check('/inventory posts one locate after the pause', fromInventory.length === 1, fromInventory);
  check(
    '/inventory names only the matching part, answered 202',
    fromInventory[0]?.status === 202 &&
      JSON.stringify(fromInventory[0]?.body) === JSON.stringify({ productIds: [stockedId] }),
  );

  await page.goto(`${WEB}/panel`);
  const fromPanel = await typeAndSettle(page, page.locator('input[inputmode="none"]'), seen);
  check('/panel posts one locate after the pause', fromPanel.length === 1, fromPanel);

  const latest = await call('GET', '/locate/latest', token);
  check(
    'the latest event lights B2 green at 2A-2D',
    JSON.stringify(latest?.drawers) ===
      JSON.stringify([{ zone: CABINET.zone, room: CABINET.room, state: 'green', cells: [IN_STOCK.cell] }]),
    latest,
  );
  const event = JSON.stringify(latest);
  check(
    'the event names no product (K2)',
    !event.includes(stockedId) && !event.includes(IN_STOCK.name) && !event.includes(BROWSER.email),
  );

  await call('POST', '/locate', token, { productIds: [runOutId] });
  const red = await call('GET', '/locate/latest', token);
  check(
    'a part that ran out lights its last cell red',
    JSON.stringify(red?.drawers) ===
      JSON.stringify([{ zone: CABINET.zone, room: CABINET.room, state: 'red', cells: [RUN_OUT.cell] }]),
    red?.drawers,
  );
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
}
const failed = results.checks.filter((entry) => !entry.ok).length;
process.stdout.write(`${results.checks.length - failed}/${results.checks.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
