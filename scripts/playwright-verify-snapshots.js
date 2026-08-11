// Playwright verification of the funding-snapshot stage selector on REQ-000018.
// Logs in as the requester, navigates to the requisition, screenshots each pill state,
// and prints the figure values for verification.
const { chromium } = require('C:/nvm4w/nodejs/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5173';
const REQ_ID = '91597307-81a8-4ed6-b0f3-57f906712c9d';
const SHOT_DIR = path.join(process.cwd(), 'playwright-shots');

if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const PILL_LABEL_BY_STATUS = {
  bom: 'BOM',
  accounts: 'Accounts',
  funded: 'Funded',
  purchased: 'Purchased',
  verified: 'Verified',
  inStock: 'In stock',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser]', msg.text());
  });

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'general@ims.local');
  await page.fill('input[type="password"]', 'demo');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 });
  console.log('[ok] logged in');

  // Navigate
  await page.goto(`${BASE}/requisitions/${REQ_ID}`, { waitUntil: 'networkidle' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Scroll to the Funds panel and screenshot the default state (inStock pill selected, since current status = STOCKED).
  const fundsHeading = page.locator('text=Money and purchasing').first();
  await fundsHeading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const panels = [];
  panels.push({
    label: 'default (inStock)',
    file: '01-default.png',
  });

  // Iterate pills
  for (const [key, label] of Object.entries(PILL_LABEL_BY_STATUS)) {
    panels.push({ label, key, file: `${key}.png` });
  }

  // Always take a default screenshot first
  await page.screenshot({
    path: path.join(SHOT_DIR, panels[0].file),
    fullPage: false,
    clip: await fundsHeading.boundingBox().then((b) => ({
      x: 0,
      y: Math.max(0, b.y - 80),
      width: 1440,
      height: Math.min(700, 1440 - b.y),
    })),
  });
  console.log(`[shot] ${panels[0].file}`);

  // For each pill, click and capture
  for (let i = 1; i < panels.length; i += 1) {
    const { label, key, file } = panels[i];
    const pill = page.getByRole('tab', { name: label, exact: true });
    const count = await pill.count();
    if (count === 0) {
      console.log(`[skip] pill "${label}" not found`);
      continue;
    }
    const isDisabled = await pill.first().isDisabled();
    if (isDisabled) {
      console.log(`[skip] pill "${label}" is disabled`);
      continue;
    }
    await pill.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SHOT_DIR, file),
      fullPage: false,
      clip: await fundsHeading.boundingBox().then((b) => ({
        x: 0,
        y: Math.max(0, b.y - 80),
        width: 1440,
        height: Math.min(700, 1440 - b.y),
      })),
    });
    console.log(`[shot] ${file}`);
  }

  // Read the figure values after each click and print for verification
  console.log('\n--- Figure values per pill ---');
  for (const [key, label] of Object.entries(PILL_LABEL_BY_STATUS)) {
    const pill = page.getByRole('tab', { name: label, exact: true });
    if ((await pill.count()) === 0 || (await pill.first().isDisabled())) {
      console.log(`${label.padEnd(10)}: disabled (no snapshot)`);
      continue;
    }
    await pill.first().click();
    await page.waitForTimeout(300);
    // Read the four figure rows under the pills panel. We use the section that has aria-controls="funding-figures".
    const figuresText = await page
      .locator('[aria-labelledby*="funding"]')
      .first()
      .innerText()
      .catch(() => '');
    console.log(`${label.padEnd(10)}: ${figuresText.replace(/\n+/g, ' | ')}`);
  }

  await browser.close();
  console.log(`\n[done] screenshots in ${SHOT_DIR}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});