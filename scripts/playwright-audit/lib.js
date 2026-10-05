// Shared harness for the Playwright role audit. See .claude/skills/playwright-audit/SKILL.md.
//
// Design rules that each cost a debugging session once:
//   - Navigate by clicking the sidebar, never `page.goto` between screens. A full reload calls
//     GET /auth/me, which is on the 10-per-60s auth tier, and the SPA treats a 429 there as
//     "signed out". Reloading seventeen times in a minute logs the audit out and fakes failures.
//   - One sign-in per role. POST /auth/login is on the same tier.
//   - Every step records the console errors, page errors and 4xx/5xx API answers that happened
//     while it ran, so "it worked but threw" is visible and "it failed" has the response beside it.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}

const { chromium } = loadPlaywright();

const CONFIG = {
  base: process.env.AUDIT_BASE_URL || 'http://localhost:5173',
  // The demo accounts share one password by design; a real deployment passes its own.
  password: process.env.AUDIT_PASSWORD || 'demo',
  emailDomain: process.env.AUDIT_EMAIL_DOMAIN || 'ims.local',
  outDir: process.env.AUDIT_OUT_DIR || path.join(process.cwd(), 'playwright-shots', 'audit'),
  stepTimeoutMs: Number(process.env.AUDIT_STEP_TIMEOUT_MS || 20000),
  headed: process.env.AUDIT_HEADED === '1',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Audit {
  constructor() {
    this.results = [];
    this.events = [];
    this.counters = {};
    this.obs = [];
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  async launch() {
    this.browser = await chromium.launch({ headless: !CONFIG.headed });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  /** A fresh browser context per role, so one role's session can never leak into the next. */
  async newRole(role, persona) {
    const context = await this.browser.newContext({ viewport: { width: 1366, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(CONFIG.stepTimeoutMs);
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // "Failed to load resource" is the browser echoing a response we already record below.
      if (m.text().startsWith('Failed to load resource')) return;
      this.events.push({ kind: 'console', text: m.text().slice(0, 200) });
    });
    page.on('pageerror', (e) => this.events.push({ kind: 'pageerror', text: e.message.slice(0, 200) }));
    page.on('response', (r) => {
      if (r.status() < 400 || !r.url().includes('/api/')) return;
      this.events.push({
        kind: 'http',
        status: r.status(),
        text: `${r.request().method()} ${r.url().replace(CONFIG.base, '')}`,
      });
    });
    return { role, persona, context, page };
  }

  /**
   * Runs one operation. `expect4xx: true` is for a negative test where the server saying no is the
   * pass condition; without it a 4xx/5xx during the step downgrades PASS to WARN.
   */
  async step(session, name, fn, opts = {}) {
    this.counters[session.role] = (this.counters[session.role] || 0) + 1;
    const n = this.counters[session.role];
    this.events = [];
    this.obs = [];
    const started = Date.now();
    const row = { role: session.role, n, name, status: 'PASS', ms: 0, notes: [], shot: null };
    try {
      await fn(session.page);
    } catch (error) {
      row.status = 'FAIL';
      row.notes.push(String(error.message).split('\n')[0].slice(0, 240));
      const file = `${session.role}-${String(n).padStart(2, '0')}-fail.png`;
      try {
        await session.page.screenshot({ path: path.join(CONFIG.outDir, file), fullPage: true });
        row.shot = file;
      } catch {
        /* the page may be gone; the note above is the evidence */
      }
      await session.page.keyboard.press('Escape').catch(() => {});
      await session.page.keyboard.press('Escape').catch(() => {});
    }
    row.ms = Date.now() - started;
    const seen = new Set();
    for (const event of this.events) {
      const line = event.kind === 'http' ? `HTTP ${event.status} ${event.text}` : `${event.kind}: ${event.text}`;
      if (seen.has(line)) continue;
      seen.add(line);
      if (event.kind === 'http' && opts.expect4xx) continue;
      row.notes.push(line);
      if (row.status === 'PASS') row.status = 'WARN';
    }
    if (opts.observe) row.notes.push(...[].concat(opts.observe).map((o) => 'OBS: ' + o));
    row.notes.push(...this.obs.map((o) => 'OBS: ' + o));
    this.results.push(row);
    const mark = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL' }[row.status];
    console.log(`[${mark}] ${session.role} #${row.n} ${name} (${row.ms} ms)${row.notes.length ? '\n         ' + row.notes.join('\n         ') : ''}`);
    return row;
  }

  /** A finding that is not a failure: something true about the app worth writing down. */
  observe(text) {
    this.obs.push(text);
  }

  note(text) {
    console.log(`  note: ${text}`);
  }

  save(extra = {}) {
    const file = path.join(CONFIG.outDir, 'results.json');
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...extra, results: this.results }, null, 2));
    return file;
  }

  summary() {
    const by = {};
    for (const r of this.results) {
      by[r.role] = by[r.role] || { PASS: 0, WARN: 0, FAIL: 0 };
      by[r.role][r.status] += 1;
    }
    return by;
  }
}

/** Signs in through the real form. Throws with the visible error text if the form refuses. */
async function signIn(page, persona) {
  await page.goto(CONFIG.base + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', `${persona}@${CONFIG.emailDomain}`);
  await page.fill('input[name=password]', CONFIG.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

/** Click a sidebar link, as a person would, and wait for the screen to settle. */
async function nav(page, href) {
  await page.locator(`nav a[href="${href}"], aside a[href="${href}"]`).first().click();
  await page.waitForURL((url) => url.pathname === href, { timeout: 10000 });
  await page.waitForLoadState('networkidle');
  await sleep(300);
}

async function heading(page, text) {
  await page.getByRole('heading', { name: text }).first().waitFor({ state: 'visible', timeout: 10000 });
}

/** Choose a <select> option by visible text (regex or string), or the first real one. */
async function pick(scope, label, which, waitMs = 8000) {
  const select = scope.getByLabel(label).first();
  await select.waitFor({ state: 'visible' });
  const deadline = Date.now() + waitMs;
  let options = [];
  let usable = [];
  let match;
  // Options of a dependent <select> (zone, then compartment) and of API-backed ones arrive after
  // the control renders, so read them until a match appears or the wait runs out.
  while (Date.now() < deadline) {
    options = await select.locator('option').evaluateAll((os) =>
      os.map((o) => ({ value: o.value, text: o.textContent.trim(), disabled: o.disabled })),
    );
    usable = options.filter((o) => o.value !== '' && !o.disabled);
    match =
      which === undefined
        ? usable[0]
        : usable.find((o) => (which instanceof RegExp ? which.test(o.text) : o.text.includes(which)));
    if (match) break;
    await sleep(250);
  }
  if (!match) throw new Error(`no option${which === undefined ? '' : ' matching ' + which} in "${label}": ${options.map((o) => o.text).join(' | ') || '(none loaded)'}`);
  await select.selectOption(match.value);
  return match.text;
}

/** First visible toast / alert text, or '' — toasts vanish, so read it right after the click. */
async function toast(page) {
  const loc = page.locator('[role=status], [role=alert], [data-sonner-toast]').filter({ hasText: /\S/ });
  try {
    await loc.first().waitFor({ state: 'visible', timeout: 4000 });
    return (await loc.first().innerText()).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function isoDatePlusDays(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function signOut(page) {
  // The bell is also aria-haspopup; the account menu is the last one in the header.
  await page.locator('button[aria-haspopup=menu]').last().click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 10000 });
}

/**
 * Fill a field in a dialog that has only just opened, and make sure the value stuck.
 * Typing within milliseconds of a dialog mounting was occasionally wiped by the dialog's own
 * first render; a person cannot type that fast, so this is a harness race, not an app defect. It
 * retries a few times and reports how many it took when more than one.
 */
async function fillStable(locator, value, onRetry) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await locator.fill(value);
    await sleep(150);
    if ((await locator.inputValue()) === value) return;
    if (onRetry) onRetry(attempt);
  }
  throw new Error(`could not keep "${value}" in the field after 4 attempts`);
}

module.exports = { Audit, CONFIG, sleep, signIn, nav, heading, pick, toast, isoDatePlusDays, signOut, fillStable };
