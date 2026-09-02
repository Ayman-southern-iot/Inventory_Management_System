/**
 * Helpers for checking the user manual against the running application.
 *
 * The manual quotes button names, field names and status words verbatim. `dump.js` uses this to
 * print what each screen actually says, so a revision can be checked rather than remembered.
 *
 * Puppeteer rather than Playwright because the API already depends on it for BOM PDFs — one
 * browser to keep working, and nothing extra to install.
 */
const path = require('path');
const { createRequire } = require('module');

const apiRequire = createRequire(path.join(__dirname, '../../../apps/api/package.json'));
const puppeteer = apiRequire('puppeteer');

const BASE = process.env.MANUAL_BASE_URL || 'http://localhost:5173';
const PASSWORD = process.env.MANUAL_DEMO_PASSWORD || 'demo';

const PEOPLE = {
  general: 'general@ims.local',
  approver1: 'approver1@ims.local',
  approver2: 'approver2@ims.local',
  im: 'im@ims.local',
  admin: 'admin@ims.local',
};

async function open() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  return { browser, page };
}

/** Waits for the network to go quiet and the app's own loading text to disappear. */
async function settle(page, ms = 500) {
  await page
    .waitForFunction(() => !/\bLoading\b/.test(document.body.innerText), { timeout: 8000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, ms));
}

async function login(page, who) {
  const email = PEOPLE[who] || who;
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name=email]');
  await page.$eval('input[name=email]', (el) => {
    el.value = '';
  });
  await page.type('input[name=email]', email);
  await page.type('input[name=password]', PASSWORD);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 }),
    page.click('button[type=submit]'),
  ]);
  await settle(page);
  page.__who = who;
  return page.url();
}

/**
 * Navigates inside the running app — no page reload.
 *
 * A reload throws away the in-memory access token and makes the app refresh it, and a full sweep
 * does that dozens of times in a minute. `/auth/login` is capped at 10 per minute per IP, so the
 * recovery path trips the limit and the sweep quietly starts reading the login page. React Router
 * listens for `popstate`, so pushing history and firing it moves the SPA without leaving the
 * session.
 */
async function go(page, pathname) {
  const here = await page.evaluate(() => location.pathname + location.search);
  if (here !== pathname) {
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, pathname);
  }
  await settle(page);
  const landed = await page.evaluate(() => location.pathname);
  if (landed.startsWith('/login') && !pathname.startsWith('/login')) {
    throw new Error('session lost on the way to ' + pathname + ' (login rate limit?)');
  }
}

/** Opens the first row of a table that navigates on click. Read-only screens only. */
async function openFirstRow(page) {
  const ok = await page.evaluate(() => {
    const row = document.querySelector('main table tbody tr');
    if (!row) return false;
    row.click();
    return true;
  });
  if (!ok) throw new Error('no table row to open');
  await settle(page, 700);
  return page.url();
}

/** What is on screen right now — headings, buttons and field names. */
async function describe(page) {
  return page.evaluate(() => ({
    url: location.pathname,
    h1: [...document.querySelectorAll('h1,h2')].map((e) => e.textContent.trim()).slice(0, 12),
    buttons: [...document.querySelectorAll('button')]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => b.textContent.trim())
      .slice(0, 30),
    inputs: [...document.querySelectorAll('input,select,textarea')]
      .map((i) => i.name || i.id || i.type)
      .slice(0, 30),
  }));
}

module.exports = { BASE, PEOPLE, open, settle, login, go, openFirstRow, describe };
