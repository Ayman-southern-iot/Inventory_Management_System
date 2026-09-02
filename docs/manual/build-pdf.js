/**
 * Renders docs/manual/manual.html to a printable A4 PDF.
 *
 *   node docs/manual/build-pdf.js
 *
 * Uses the same Chromium the API already uses for BOM documents, so there is one browser to keep
 * working rather than two.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const apiRequire = createRequire(path.join(__dirname, '../../apps/api/package.json'));
const puppeteer = apiRequire('puppeteer');

const SOURCE = path.join(__dirname, 'manual.html');
const OUTPUT = path.join(__dirname, 'IMS-User-Manual.pdf');

// Running headers and footers are a separate mini-document with their own stylesheet — none of
// the page's CSS reaches them, so every rule they need is inline.
const FOOT = `
  <div style="width:100%;font:8pt 'Segoe UI',Arial,sans-serif;color:#6b7280;
              padding:0 16mm;display:flex;justify-content:space-between;">
    <span>Inventory Management System &mdash; User Manual</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

const HEAD = '<div></div>';

(async () => {
  if (!fs.existsSync(SOURCE)) throw new Error('missing ' + SOURCE);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  try {
    const page = await browser.newPage();
    await page.goto('file:///' + SOURCE.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

    await page.pdf({
      path: OUTPUT,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEAD,
      footerTemplate: FOOT,
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
  } finally {
    await browser.close();
  }

  const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
  console.log('wrote ' + OUTPUT + '  (' + kb + ' KB)');
})().catch((e) => {
  console.error('FAILED: ' + e.stack);
  process.exit(1);
});
