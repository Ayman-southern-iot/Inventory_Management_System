#!/usr/bin/env node
// Message catalogue: provokes error, validation and refusal messages across the app and records the
// exact text a person would see. One scenario = one trigger; the result is what appeared in toasts,
// inline errors, alerts and the browser's own validation bubble. Used for the copy review in
// docs/message_audit.md; see .claude/skills/playwright-audit/SKILL.md.
//
//   node scripts/playwright-audit/messages.js            -> prints a table, writes messages.json
//
// Uses existing data only (no run state). Only negative or refusing actions: it creates nothing that
// matters, but it does sign in as three roles and makes one failed login with a non-existent email.
const fs = require('fs');
const path = require('path');
const { Audit, CONFIG, nav, sleep, signIn, signOut, fillStable } = require('./lib');

const found = [];

/** Everything visible that reads like a message right now. */
async function visibleMessages(page) {
  return page.evaluate(() => {
    const out = new Set();
    const add = (kind, text) => {
      const clean = (text || '').replace(/\s+/g, ' ').trim();
      if (clean && clean.length < 400) out.add(`${kind}: ${clean}`);
    };
    document.querySelectorAll('[aria-live] > *').forEach((el) => add('toast', el.innerText));
    document.querySelectorAll('[role=alert]').forEach((el) => add('inline', el.innerText));
    document.querySelectorAll('[class*="text-danger"]').forEach((el) => {
      if (el.children.length === 0) add('inline', el.innerText);
    });
    document.querySelectorAll('input:invalid, select:invalid, textarea:invalid').forEach((el) => {
      if (el.validationMessage) add('browser', el.validationMessage);
    });
    document.querySelectorAll('[role=dialog] p, main p').forEach((el) => {
      if (/not (available|allowed|possible)|cannot|could not|already|required|too |must|invalid|enough|exceed/i.test(el.innerText) && el.innerText.length < 220) {
        if (el.className && /(muted|subtle|hint)/.test(el.className) === false) add('text', el.innerText);
      }
    });
    return [...out];
  });
}

async function scenario(page, id, role, where, trigger, fn) {
  let before = [];
  try {
    before = await visibleMessages(page);
    // A driver may return the page text it wants recorded (a 404, an empty state).
    const seen = await fn();
    await sleep(900);
    const after = await visibleMessages(page);
    const fresh = after.filter((m) => !before.includes(m));
    found.push({
      id,
      role,
      where,
      trigger,
      messages: fresh.length ? fresh : ['(nothing new appeared)'],
      ...(typeof seen === 'string' ? { page: seen } : {}),
    });
  } catch (error) {
    found.push({ id, role, where, trigger, messages: [`(could not drive: ${String(error.message).split('\n')[0].slice(0, 120)})`] });
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(250);
}

const click = (page, name, opts = {}) => page.getByRole('button', { name, exact: true, ...opts }).first().click();

async function loggedOut(audit) {
  const s = await audit.newRole('LOGGED-OUT', 'x');
  const { page } = s;
  await page.goto(`${CONFIG.base}/login`, { waitUntil: 'networkidle' });
  const submit = () => page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await scenario(page, 'L1', 'Anyone', 'Login', 'Submit with both fields empty', async () => submit());
  await scenario(page, 'L2', 'Anyone', 'Login', 'Email "abc" (not an address)', async () => {
    await page.fill('input[name=email]', 'abc');
    await page.fill('input[name=password]', 'x');
    await submit();
  });
  await scenario(page, 'L3', 'Anyone', 'Login', 'Unknown email, wrong password', async () => {
    await page.fill('input[name=email]', 'nobody@ims.local');
    await page.fill('input[name=password]', 'wrongpass');
    await submit();
  });
  await s.context.close();
}

async function general(audit) {
  const s = await audit.newRole('GENERAL', 'general');
  const { page } = s;
  await signIn(page, 'general');

  await nav(page, '/projects');
  await scenario(page, 'G1', 'General', 'New project', 'Name left empty', async () => {
    await click(page, 'New project');
    await click(page, 'Create');
  });
  await scenario(page, 'G2', 'General', 'New project', 'Name of one character', async () => {
    await click(page, 'New project');
    await fillStable(page.getByLabel(/Project name/), 'A');
    await click(page, 'Create');
  });
  await scenario(page, 'G3', 'General', 'New project', 'Name that already exists', async () => {
    // A real existing project name. (Taking the first piece of text on the page once picked a button
    // and created a project called "New project".)
    const existing = (await page.locator('main').getByText(/^AUD-/).first().innerText()).split('\n')[0].trim();
    await click(page, 'New project');
    await fillStable(page.getByLabel(/Project name/), existing);
    await click(page, 'Create');
  });

  await nav(page, '/inventory');
  await page.getByText('Lenovo ThinkPad T14').first().click();
  await page.getByRole('heading', { name: 'Lenovo ThinkPad T14' }).waitFor();
  await scenario(page, 'G4', 'General', 'Borrow dialog', 'Quantity 0', async () => {
    await click(page, 'Borrow');
    const d = page.getByRole('dialog');
    await d.getByLabel(/Quantity/).fill('0');
    await d.getByRole('button', { name: 'Borrow', exact: true }).click();
  });
  await scenario(page, 'G5', 'General', 'Borrow dialog', 'Quantity far above what is available', async () => {
    await click(page, 'Borrow');
    const d = page.getByRole('dialog');
    await d.getByLabel(/Quantity/).fill('9999');
    await d.getByRole('button', { name: 'Borrow', exact: true }).click();
  });
  await scenario(page, 'G6', 'General', 'Borrow dialog', 'Returnable, no expected-back date', async () => {
    await click(page, 'Borrow');
    const d = page.getByRole('dialog');
    await d.getByLabel(/Quantity/).fill('1');
    await d.getByRole('button', { name: 'Borrow', exact: true }).click();
  });

  await nav(page, '/my-requisitions');
  await click(page, 'New requisition');
  await page.getByRole('heading', { name: 'New requisition' }).waitFor();
  await scenario(page, 'G7', 'General', 'New requisition', 'Submit with nothing filled in', async () => click(page, 'Submit for approval'));
  await scenario(page, 'G8', 'General', 'New requisition', 'Quantity 0 and a negative price, then submit', async () => {
    await page.getByLabel(/Reason/).fill('probe');
    await page.getByLabel('Item 1').fill('Probe item');
    await page.getByLabel('Quantity 1').fill('0');
    await page.getByLabel('Unit price (BDT) 1').fill('-5');
    await click(page, 'Submit for approval');
  });
  await scenario(page, 'G9', 'General', 'New requisition', 'Attach a file that is not allowed (.exe)', async () => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'probe.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  });
  await scenario(page, 'G10', 'General', 'New requisition', 'Attach a 6 MB PDF', async () => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
  });

  await page.locator('button[aria-haspopup=menu]').last().click();
  await page.getByRole('menuitem', { name: /account/i }).click();
  await page.waitForURL((u) => u.pathname === '/account/profile');
  await sleep(600);
  await scenario(page, 'G11', 'General', 'Profile, signature', 'Upload a text file as the signature', async () => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'sig.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  });

  await page.goto(`${CONFIG.base}/account/password`, { waitUntil: 'networkidle' });
  await scenario(page, 'G12', 'General', 'Change password', 'Submit empty', async () => page.getByRole('button', { name: /change|save|update/i }).last().click());
  await scenario(page, 'G13', 'General', 'Change password', 'New passwords that do not match', async () => {
    await page.getByLabel('Current password').fill('x');
    await page.getByLabel('New password', { exact: true }).fill('abcd1');
    await page.getByLabel('Confirm new password').fill('abcd2');
    await page.getByRole('button', { name: /change|save|update/i }).last().click();
  });
  await scenario(page, 'G14', 'General', 'Change password', 'Wrong current password', async () => {
    await page.getByLabel('Current password').fill('definitely-wrong');
    await page.getByLabel('New password', { exact: true }).fill('abcd1');
    await page.getByLabel('Confirm new password').fill('abcd1');
    await page.getByRole('button', { name: /change|save|update/i }).last().click();
  });
  await scenario(page, 'G15', 'General', 'Unknown address', 'Open /this-page-does-not-exist', async () => {
    await page.goto(`${CONFIG.base}/this-page-does-not-exist`, { waitUntil: 'networkidle' });
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
  });
  await scenario(page, 'G16', 'General', 'No permission', 'Open /admin/users', async () => {
    await page.goto(`${CONFIG.base}/admin/users`, { waitUntil: 'networkidle' });
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
  });
  await s.context.close();
}

async function im(audit, state) {
  const s = await audit.newRole('IM', 'im');
  const { page } = s;
  await signIn(page, 'im');

  await nav(page, '/inventory');
  await scenario(page, 'I1', 'IM', 'New product', 'Save with the name empty', async () => {
    await click(page, 'New product');
    await page.getByRole('dialog').getByRole('button', { name: 'Save product' }).click();
  });
  await page.getByText('Lenovo ThinkPad T14').first().click();
  await page.getByRole('heading', { name: 'Lenovo ThinkPad T14' }).waitFor();
  await scenario(page, 'I2', 'IM', 'Receive stock', 'Save with nothing chosen', async () => {
    await click(page, 'Receive stock');
    await page.getByRole('dialog').getByRole('button', { name: 'Receive stock', exact: true }).click();
  });
  await scenario(page, 'I3', 'IM', 'Adjust stock', 'Remove far more than exists', async () => {
    await click(page, 'Adjust stock');
    const d = page.getByRole('dialog');
    const sel = d.getByLabel(/Compartment/);
    const opts = await sel.locator('option').evaluateAll((o) => o.filter((x) => x.value).map((x) => x.value));
    await sel.selectOption(opts[0]);
    await d.getByLabel(/Adjustment/).fill('-9999');
    await d.getByLabel(/Reason/).fill('probe');
    await d.getByRole('button', { name: 'Save', exact: true }).click();
  });
  await scenario(page, 'I4', 'IM', 'Move stock', 'Move far more than exists', async () => {
    await click(page, 'Move stock');
    const d = page.getByRole('dialog');
    const from = d.getByLabel(/From/).first();
    const fo = await from.locator('option').evaluateAll((o) => o.filter((x) => x.value).map((x) => x.value));
    await from.selectOption(fo[0]);
    const to = d.getByLabel(/^To/).first();
    const tos = await to.locator('option').evaluateAll((o) => o.filter((x) => x.value && !x.disabled).map((x) => x.value));
    if (tos.length) await to.selectOption(tos[0]);
    await d.getByLabel(/Quantity/).fill('9999');
    await d.getByRole('button', { name: 'Move stock', exact: true }).click();
  });

  await nav(page, '/inventory/locations');
  await scenario(page, 'I5', 'IM', 'New room', 'Name already used (Main Store)', async () => {
    await click(page, 'New room');
    await fillStable(page.getByLabel(/Room name/), 'Main Store');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  });
  await scenario(page, 'I6', 'IM', 'New room', 'Name left empty', async () => {
    await click(page, 'New room');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  });

  await nav(page, '/inventory/categories');
  await scenario(page, 'I7', 'IM', 'Categories', 'Add a top-level category that already exists (Laptops)', async () => {
    await click(page, 'Add top-level category');
    const input = page.getByPlaceholder('Top-level category name');
    await input.fill('Laptops');
    await input.press('Enter');
  });

  await nav(page, '/borrowing');
  await scenario(page, 'I8', 'IM', 'Borrowing queue', 'Open the Pending list (empty state wording)', async () => {
    await page.getByRole('button', { name: 'Pending', exact: true }).click();
  });

  // Read-only: pressing Generate with the fields empty created a real BOM the first time.
  if (state && state.reqs && state.reqs.D) {
    await scenario(page, 'I9', 'IM', 'New BOM', 'Open the builder (no Generate)', async () => {
      await page.goto(`${CONFIG.base}/boms/new?requisition=${state.reqs.D.path.split('/').pop()}`, { waitUntil: 'networkidle' });
      return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    });
  }
  await nav(page, '/inventory/imports');
  await scenario(page, 'I10', 'IM', 'Bulk import', 'Open the page (deferred feature)', async () => {
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160);
  });
  await s.context.close();
}

async function admin(audit) {
  const s = await audit.newRole('ADMIN', 'admin');
  const { page } = s;
  await signIn(page, 'admin');

  await nav(page, '/admin/users');
  await scenario(page, 'A1', 'Admin', 'New user', 'Save with everything empty', async () => {
    await click(page, 'New user');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  });
  await scenario(page, 'A2', 'Admin', 'New user', 'Email "not-an-email", one-character password', async () => {
    await click(page, 'New user');
    const d = page.getByRole('dialog');
    await fillStable(d.getByLabel(/Full name/), 'Probe User');
    await d.getByLabel(/^Email/).fill('not-an-email');
    await d.getByLabel(/Designation/).fill('Tester');
    await d.getByLabel(/Initial password/).fill('1');
    await d.getByRole('button', { name: 'Save' }).click();
  });
  await scenario(page, 'A3', 'Admin', 'New user', 'Email that already belongs to someone', async () => {
    await click(page, 'New user');
    const d = page.getByRole('dialog');
    await fillStable(d.getByLabel(/Full name/), 'Probe User');
    await d.getByLabel(/^Email/).fill('general@ims.local');
    await d.getByLabel(/Designation/).fill('Tester');
    await d.getByLabel(/Initial password/).fill('Probe-pass-1');
    await d.getByRole('button', { name: 'Save' }).click();
  });

  await nav(page, '/admin/departments');
  await scenario(page, 'A4', 'Admin', 'New department', 'Name left empty', async () => {
    await click(page, 'New department');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  });
  await scenario(page, 'A5', 'Admin', 'New department', 'Name already used (Accounts)', async () => {
    await click(page, 'New department');
    await fillStable(page.getByRole('dialog').getByLabel(/^Name/), 'Accounts');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  });

  await nav(page, '/admin/settings');
  // Not run: the app accepts a threshold of 0 and saves it. That changes a real setting, so a probe
  // must not do it (the first run did, and it had to be restored to 15000).
  await scenario(page, 'A7', 'Admin', 'Settings', 'Expense threshold set to a negative number, then Save', async () => {
    const f = page.getByLabel('Expense threshold');
    await f.fill('-5');
    await f.locator('xpath=ancestor::*[.//button[normalize-space(.)="Save"]][1]').getByRole('button', { name: 'Save', exact: true }).first().click();
  });

  await nav(page, '/admin/api-keys');
  await scenario(page, 'A8', 'Admin', 'API keys', 'Issue a key with no name and no scope', async () => {
    await click(page, 'New key');
    await page.getByRole('dialog').getByRole('button', { name: 'Issue key' }).click();
  });
  await scenario(page, 'A9', 'Admin', 'API keys', 'Add a service account with an empty name', async () => {
    await click(page, 'Create account');
  });
  await s.context.close();
}

async function main() {
  const audit = new Audit();
  await audit.launch();
  let state = null;
  try {
    const candidate = process.env.AUDIT_RESUME || path.join(CONFIG.outDir, 'results-final.json');
    if (fs.existsSync(candidate)) state = require(path.resolve(candidate)).state;
  } catch {
    state = null;
  }
  try {
    await loggedOut(audit);
    await sleep(3000);
    await general(audit);
    await sleep(3000);
    await im(audit, state);
    await sleep(3000);
    await admin(audit);
  } finally {
    await audit.close();
  }
  const file = path.join(CONFIG.outDir, 'messages.json');
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), scenarios: found }, null, 2));
  for (const f of found) {
    console.log(`\n[${f.id}] ${f.role} · ${f.where} · ${f.trigger}`);
    for (const m of f.messages) console.log(`    ${m}`);
    if (f.page) console.log(`    page: ${f.page}`);
  }
  console.log('\nwrote', file);
}

main().catch((error) => {
  console.error('MESSAGES CRASHED', error);
  process.exit(2);
});
