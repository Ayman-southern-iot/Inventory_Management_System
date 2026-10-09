#!/usr/bin/env node
/* global window, document, requestAnimationFrame, cancelAnimationFrame, getComputedStyle -- used inside page.evaluate() callbacks, which run in the browser */
/**
 * Local-only browser check of `/room` (not in CI yet). Drives a production build of the web app
 * against a dev API that has the v4 drawer plan, never against production: it refuses any web
 * address that is not this machine.
 *
 *   <admin password on stdin> | node scripts/room-e2e/room-e2e.mjs --admin-email <email> [options]
 *
 * The admin's password is read from stdin, so it is never in the process list, shell history or
 * any log; for the keeper's dev API: `ssh <keeper> "sed -n 's/^SEED_ADMIN_PASSWORD=//p' ~/ims-dev/api.env"`.
 *
 * Options:
 *   --web <url>          the web app, e.g. `vite preview` proxying /api   [http://127.0.0.1:4173]
 *   --api <url>          the API the seed writes to, called directly     [http://127.0.0.1:3010/api/v1]
 *   --admin-email <e>    an admin on that API, to seed with              (required)
 *   --out <dir>          where screenshots and results.json go          [playwright-shots/room]
 *   --throttle <n>       CPU slowdown for the timing runs               [4]
 *   --playwright <path>  a Playwright package, if not resolvable by name
 *
 * Both addresses must be this machine. The seed writes only to `--api`; the browser then signs in
 * through `--web` as the account the seed made, so a web build proxying to any other API stops
 * at sign-in, before it has read anything. A loopback port tunnelled to production would pass
 * these checks: never point `--api` at one.
 *
 * Seeds, idempotently, through the API: two parts in their v4 cells (STS3215 → B2-2A-2D,
 * ESP32-S3 → A2-1A) and a GENERAL account to browse as, whose password is reset to a fresh random
 * value each run. Then, at 1366×768: overview, search "STS3215", the `?cell=A2-1A` deep link and
 * the dark theme; the panel's 1280×800; and a narrow screen, which must not load three.js. Every
 * request made on `/room` is kept, and the catalogue's answers are searched for person data (K2).
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
const OUT = resolve(flag('out', 'playwright-shots/room'));
const THROTTLE = Number(flag('throttle', '4'));
const ADMIN = { email: flag('admin-email', ''), password: readFileSync(0, 'utf8').trim() };
const BROWSER = { email: 'room-e2e@ims.local', fullName: 'Room Check Account' };
const PARTS = [
  {
    name: 'STS3215 serial bus servo (e2e)',
    room: 'Cabinet B',
    zone: 'B2',
    compartment: '2A-2D',
    quantity: 14,
  },
  {
    name: 'ESP32-S3 DevKitC-1 (e2e)',
    room: 'Cabinet A',
    zone: 'A2',
    compartment: '1A',
    quantity: 5,
  },
];
/** Same list as panel-no-person-data.int-spec.ts: field names that only ever hold a person. */
const PERSON_FIELDS = [
  'borrowerId',
  'requesterId',
  'borrowerName',
  'requesterName',
  'userId',
  'fullName',
  'email',
  'performedBy',
  'createdBy',
];
const READY = '[data-room-ready="true"]';
const SETTLE_MS = 2_500;
/** How long to wait for IMS data to reach the side list. */
const DATA_TIMEOUT_MS = 15_000;
const ORBIT_MS = 5_000;
/** More than Chrome's 16 live WebGL contexts, so a leak would show. */
const ROUND_TRIPS = 20;

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
const results = { web: WEB, api: API, throttle: THROTTLE, checks: [] };
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

async function seed() {
  const { accessToken: token } = await call('POST', '/auth/login', null, ADMIN);
  let catalogue = await call('GET', '/catalogue', token);
  for (const part of PARTS) {
    const shelf = catalogue.locations.find(
      (at) => at.room === part.room && at.zone === part.zone && at.compartment === part.compartment,
    );
    if (shelf === undefined)
      throw new Error(
        `the dev API has no ${part.room} / ${part.zone} / ${part.compartment}: load the drawer plan first`,
      );
    let product = catalogue.products.find((item) => item.name === part.name);
    if (product === undefined)
      product = await call('POST', '/products', token, { name: part.name });
    const held = (product.locations ?? []).some(
      (at) => at.compartmentId === shelf.compartmentId && at.quantity > 0,
    );
    if (!held) {
      await call(
        'POST',
        '/stock/receive',
        token,
        {
          productId: product.id,
          compartmentId: shelf.compartmentId,
          quantity: part.quantity,
          note: 'room e2e seed',
        },
        { 'Idempotency-Key': randomUUID() },
      );
    }
    catalogue = await call('GET', '/catalogue', token);
  }
  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const found = await call(
    'GET',
    `/admin/users?search=${encodeURIComponent(BROWSER.email)}`,
    token,
  );
  const existing = found.items.find((user) => user.email === BROWSER.email);
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
  return password;
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
    throw new Error(
      `sign-in through ${WEB} answered ${response.status()}: is it proxying to ${API}?`,
    );
  }
  await page.waitForURL((url) => url.pathname !== '/login');
}

/** The side list's heading and text once IMS data for `part` has reached it. */
async function sideListShowing(page, part) {
  const aside = page.locator('aside');
  await aside.getByText(part).first().waitFor({ timeout: DATA_TIMEOUT_MS });
  return {
    heading: await aside.locator('h2').first().textContent(),
    text: await aside.textContent(),
  };
}

/** Requests made while on /room, and whether any catalogue answer names a person. */
function recordRequests(page) {
  const seen = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(WEB).origin) return;
    const entry = {
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
    };
    if (url.pathname === '/api/v1/catalogue') {
      const body = await response.text().catch(() => '');
      entry.personFields = PERSON_FIELDS.filter((field) => body.includes(`"${field}"`));
      entry.namesBrowser =
        body.includes(BROWSER.fullName) ||
        body.includes(BROWSER.email) ||
        body.includes(ADMIN.email);
    }
    seen.push(entry);
  });
  return seen;
}

async function throttle(page, rate) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/** Drags the camera round for ORBIT_MS and counts the frames the page drew meanwhile. */
async function orbitFps(page) {
  const box = await page.locator('[role="img"] canvas').boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(() => {
    window.__frames = 0;
    const tick = () => {
      window.__frames += 1;
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < ORBIT_MS) {
    step += 1;
    await page.mouse.move(
      centre.x + Math.sin(step / 20) * 200,
      centre.y + Math.cos(step / 30) * 40,
    );
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames;
  });
  return Math.round((frames / ((Date.now() - started) / 1_000)) * 10) / 10;
}

const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const password = await seed();
  check('seeded the dev API (2 parts, 1 GENERAL account)', true);

  // 1366×768, light: load time and fps under CPU throttle, then the overview.
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const consoleProblems = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) consoleProblems.push(message.text());
  });
  const failedResponses = [];
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await signIn(page, password);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  results.gpu = gpu;
  check(
    'room link shown in the menu at 1366 px',
    (await page.getByRole('link', { name: 'Room view' }).count()) === 1,
  );

  const requests = recordRequests(page);
  await throttle(page, THROTTLE);
  await page.goto(`${WEB}/room`);
  await page.locator(READY).waitFor({ timeout: 30_000 });
  const loadMs = await page.evaluate(
    () => performance.getEntriesByName('room-first-frame')[0]?.startTime ?? -1,
  );
  results.loadMs = Math.round(loadMs);
  check(`first frame at ${THROTTLE}× CPU throttle ≤ 2500 ms`, loadMs > 0 && loadMs <= 2_500, {
    loadMs: Math.round(loadMs),
    gpu,
  });
  await page.waitForTimeout(SETTLE_MS);
  results.fps = await orbitFps(page);
  check(`orbit at ${THROTTLE}× CPU throttle ≥ 50 fps`, results.fps >= 50, { fps: results.fps });
  await throttle(page, 1);
  results.fpsUnthrottled = await orbitFps(page);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(OUT, '1-overview-1366.png') });

  // Search "STS3215" → B2-2A-2D.
  await page.keyboard.press('/');
  await page.keyboard.type('STS3215');
  await page
    .getByRole('option', { name: /STS3215/ })
    .first()
    .waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(/[?&]cell=B2-2A-2D/);
  const searched = await sideListShowing(page, 'STS3215');
  await page.waitForTimeout(SETTLE_MS);
  check('search "STS3215" lights B2-2A-2D', searched.heading === 'B2-2A-2D', {
    heading: searched.heading,
    url: page.url().replace(WEB, ''),
  });
  await page.screenshot({ path: join(OUT, '2-search-sts3215.png') });

  // Deep link.
  await page.goto(`${WEB}/room?cell=A2-1A`);
  await page.locator(READY).waitFor();
  const linked = await sideListShowing(page, 'ESP32-S3');
  await page.waitForTimeout(SETTLE_MS);
  check('/room?cell=A2-1A focuses the ESP32-S3 cell', linked.heading === 'A2-1A', {
    heading: linked.heading,
  });
  await page.screenshot({ path: join(OUT, '3-deep-link-a2-1a.png') });

  // K2: what /room asked for, and what the catalogue said.
  results.requests = requests.filter(
    (entry) => entry.path.startsWith('/api/') || entry.path.includes('scene-v4'),
  );
  const catalogueAnswers = requests.filter((entry) => entry.path === '/api/v1/catalogue');
  check(
    'K2: no catalogue answer carries a person field or a known name',
    catalogueAnswers.length > 0 &&
      catalogueAnswers.every((entry) => entry.personFields.length === 0 && !entry.namesBrowser),
    { catalogueCalls: catalogueAnswers.length },
  );
  // Leaving and re-entering /room inside the app must give each WebGL context back: Chrome warns,
  // and drops the oldest, past 16 live contexts.
  await throttle(page, 1);
  for (let round = 0; round < ROUND_TRIPS; round += 1) {
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/inventory');
    await page.getByRole('link', { name: 'Room view' }).click();
    await page.locator(READY).waitFor();
  }
  const contextWarnings = consoleProblems.filter((text) => /WebGL context/i.test(text));
  check(
    `${ROUND_TRIPS} round trips /room ↔ /inventory leave no WebGL context behind`,
    contextWarnings.length === 0,
    { contextWarnings },
  );

  // Dark theme and the panel's 1280×800, on the same page: every new browser context is another
  // sign-in, and the API rate-limits sign-ins per address (a local tunnel is one address).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${WEB}/room?cell=B2-2A-2D`);
  await page.locator(READY).waitFor();
  await sideListShowing(page, 'STS3215');
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(OUT, '4-dark-b2-2a-2d.png') });
  const darkGround = await page
    .locator('[data-room-theme]')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  check('dark theme: the room takes the dark tokens', darkGround !== 'rgb(255, 255, 255)', {
    background: darkGround,
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${WEB}/room?cell=B2-2A-2D`);
  await page.locator(READY).waitFor();
  const panelSized = await sideListShowing(page, 'STS3215');
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(OUT, '5-1280x800.png') });
  check('1280×800 renders the room', panelSized.heading === 'B2-2A-2D');

  results.consoleProblems = consoleProblems;
  results.failedResponses = failedResponses;
  await context.close();

  // Narrow: the notice, no menu link, and three.js never fetched.
  const narrow = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const narrowPage = await narrow.newPage();
  const fetched = [];
  narrowPage.on('request', (request) => fetched.push(new URL(request.url()).pathname));
  await signIn(narrowPage, password);
  await narrowPage.goto(`${WEB}/room`);
  await narrowPage.getByRole('heading', { name: 'Open this on a PC' }).waitFor();
  check(
    'narrow screen: "open this on a PC", no 3D, no scene',
    !fetched.some((path) => path.includes('RoomCanvas') || path.includes('scene-v4')),
    {
      fetchedRoomChunks: fetched.filter((path) => path.includes('Room')),
    },
  );
  await narrowPage.screenshot({ path: join(OUT, '6-narrow-1000.png') });
  await narrow.close();
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
}
process.exit(results.checks.every((entry) => entry.ok) ? 0 : 1);
