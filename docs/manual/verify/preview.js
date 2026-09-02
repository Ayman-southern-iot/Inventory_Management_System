/**
 * Renders the manual at exactly the printed text-column size so the typography can be checked
 * before trusting the PDF. A4 minus the margins build-pdf.js applies, at 96dpi.
 */
const path = require('path');
const { createRequire } = require('module');

const apiRequire = createRequire(path.join(__dirname, '../../../apps/api/package.json'));
const puppeteer = apiRequire('puppeteer');

const MM = 96 / 25.4;
const WIDTH = Math.round((210 - 16 * 2) * MM);
const HEIGHT = Math.round((297 - 18 - 20) * MM);

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    await page.emulateMediaType('print');
    await page.goto('file:///' + path.join(__dirname, '..', 'manual.html').replace(/\\/g, '/'), {
      waitUntil: 'networkidle0',
    });

    const targets = process.argv.slice(2);
    const shots = targets.length ? targets : ['0'];
    for (const t of shots) {
      if (/^\d+$/.test(t)) {
        await page.evaluate((y) => window.scrollTo(0, y), Number(t) * HEIGHT);
      } else {
        await page.evaluate((text) => {
          const el = [...document.querySelectorAll('h2,h3')].find((h) =>
            h.textContent.toLowerCase().includes(text.toLowerCase()),
          );
          if (el) el.scrollIntoView({ block: 'start' });
        }, t);
      }
      await new Promise((r) => setTimeout(r, 250));
      const name = 'preview-' + t.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
      await page.screenshot({ path: path.join(__dirname, name) });
      console.log(name);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
