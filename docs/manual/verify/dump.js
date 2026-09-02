/**
 * Prints the visible text of each screen, per persona.
 *
 * The manual is written from this, not from memory: every button name and every wording in it
 * has to be what the screen actually says.
 */
const L = require('./lib');

const PLAN = {
  general: ['/', '/inventory', '/my-borrowings', '/my-requisitions', '/projects'],
  approver1: ['/approvals', '/expenses'],
  im: ['/borrowing', '/all-requisitions', '/boms', '/boms/new', '/inventory/categories', '/inventory/locations'],
  admin: ['/admin/users', '/admin/departments', '/admin/settings', '/admin/audit-log'],
};

(async () => {
  const { browser, page } = await L.open();
  try {
    let first = true;
    for (const [who, paths] of Object.entries(PLAN)) {
      // `/auth/login` allows 10 a minute per IP. Four personas in a row is well inside that on its
      // own, but a run following an earlier one is not — so pace them rather than fight the limit.
      if (!first) await new Promise((r) => setTimeout(r, 20000));
      first = false;
      await L.login(page, who);
      for (const p of paths) {
        try {
          await L.go(page, p);
          const text = await page.evaluate(() => {
            const main = document.querySelector('main');
            return main ? main.innerText.replace(/\n{3,}/g, '\n\n') : '(no main)';
          });
          console.log('\n########## ' + who + '  ' + p + ' ##########');
          console.log(text.slice(0, 1600));
        } catch (e) {
          console.log('\n########## ' + who + '  ' + p + '  FAILED: ' + e.message);
        }
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL: ' + e.stack);
  process.exit(1);
});
