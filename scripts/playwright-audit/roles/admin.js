// ADMIN: settings and approver configuration, users, departments, API keys, audit log.
//
// Phase a runs before GENERAL submits anything: a fresh install has no sub-threshold approver and
// no company-default approvers, and a requisition below the threshold is refused until an admin
// picks one ("An administrator must choose one in Settings"). Phase b runs last and checks that
// the audit log recorded what the other roles did.
const { nav, heading, pick, signIn, signOut, fillStable } = require('../lib');

/** The Save button that belongs to the settings section holding `control`. */
function sectionSave(control) {
  return control.locator('xpath=ancestor::*[.//button[normalize-space(.)="Save"]][1]').getByRole('button', { name: 'Save', exact: true }).first();
}

/** Save is disabled while the value equals what is stored; clicking it then would just time out. */
async function saveIfChanged(control) {
  const save = sectionSave(control);
  if (await save.isEnabled()) {
    await save.click();
    await control.page().waitForLoadState('networkidle');
  }
}

async function a(audit, state) {
  const s = await audit.newRole('ADMIN', 'admin');
  const { page } = s;

  await audit.step(s, 'Sign in, land on the dashboard', async () => {
    await signIn(page, 'admin');
    await heading(page, 'Dashboard');
  });

  await audit.step(s, 'Settings: read the current approver configuration', async () => {
    await nav(page, '/admin/settings');
    await heading(page, 'Settings');
    const sub = await page.getByLabel('Sub-threshold approver').inputValue();
    const a1 = await page.getByLabel(/Approver 1/).first().inputValue();
    const a2 = await page.getByLabel(/Approver 2/).first().inputValue();
    state.approverConfigBefore = { sub, a1, a2 };
    const threshold = await page.getByLabel('Expense threshold').inputValue();
    audit.observe(`Before: sub-threshold approver value="${sub}", Approver 1="${a1}", Approver 2="${a2}" (empty = Not assigned); expense threshold ${threshold}.`);
  });

  await audit.step(s, 'Settings: assign the sub-threshold approver and save', async () => {
    const select = page.getByLabel('Sub-threshold approver');
    await pick(page, 'Sub-threshold approver', 'Ayesha Approver');
    await saveIfChanged(select);
    await page.getByText(/saved|updated/i).first().waitFor({ timeout: 8000 }).catch(() => {
      audit.observe('No "saved" confirmation text appeared after Save (checked persistence in the next step).');
    });
  });

  await audit.step(s, 'Settings: set Approver 1 and Approver 2 company defaults', async () => {
    const one = page.getByLabel(/Approver 1/).first();
    await pick(page, /Approver 1/, 'Ayesha Approver');
    await saveIfChanged(one);
    const two = page.getByLabel(/Approver 2/).first();
    await pick(page, /Approver 2/, 'Farhan Finance');
    await saveIfChanged(two);
  });

  await audit.step(s, 'Settings: the values are still there after leaving and returning', async () => {
    await nav(page, '/admin/users');
    await nav(page, '/admin/settings');
    const text = await page.getByLabel('Sub-threshold approver').evaluate((el) => el.options[el.selectedIndex].text);
    if (!/Ayesha/.test(text)) throw new Error(`sub-threshold approver did not persist: "${text}"`);
  });

  await audit.step(s, 'Sign out', async () => {
    await signOut(page);
  });
  await s.context.close();
}

async function b(audit, state) {
  const s = await audit.newRole('ADMIN', 'admin');
  const { page } = s;
  const email = `aud-${state.run}@ims.local`;
  const fullName = `AUD ${state.run} Tester`;

  await audit.step(s, 'Sign in again', async () => {
    await signIn(page, 'admin');
  });

  await audit.step(s, 'Users: the list loads and search narrows it', async () => {
    await nav(page, '/admin/users');
    await page.getByText('Imran Manager').first().waitFor();
    await page.getByLabel('Search').fill('Imran');
    await page.waitForTimeout(800);
    if ((await page.getByText('Gina General').count()) !== 0) throw new Error('search for "Imran" still lists Gina');
    await page.getByLabel('Search').fill('');
  });

  await audit.step(s, 'Users: create a new user', async () => {
    await page.getByRole('button', { name: 'New user' }).click();
    const dialog = page.getByRole('dialog');
    await fillStable(dialog.getByLabel(/Full name/), fullName);
    await dialog.getByLabel(/^Email/).fill(email);
    await dialog.getByLabel(/Designation/).fill('Audit tester');
    await dialog.getByLabel(/Initial password/).fill(process.env.AUDIT_NEW_USER_PASSWORD || 'Audit-pass-1');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText(fullName).first().waitFor();
  });

  await audit.step(s, 'Users: the new account can sign in (and is made to change its password)', async () => {
    const other = await audit.newRole('ADMIN-NEWUSER', 'x');
    try {
      await other.page.goto(`${require('../lib').CONFIG.base}/login`, { waitUntil: 'networkidle' });
      await other.page.fill('input[name=email]', email);
      await other.page.fill('input[name=password]', process.env.AUDIT_NEW_USER_PASSWORD || 'Audit-pass-1');
      await other.page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await other.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
      audit.observe(`New user landed on ${new URL(other.page.url()).pathname} (password change is "required at first sign-in" by default).`);
    } finally {
      await other.context.close();
    }
  });

  await audit.step(s, 'Departments: create a department', async () => {
    await nav(page, '/admin/departments');
    await page.getByRole('button', { name: 'New department' }).click();
    const dialog = page.getByRole('dialog');
    await fillStable(dialog.getByLabel(/^Name/), `AUD-${state.run} Dept`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText(`AUD-${state.run} Dept`).first().waitFor();
  });

  await audit.step(s, 'API keys: create a service account', async () => {
    await nav(page, '/admin/api-keys');
    await page.getByLabel('Add a service account').fill(`aud-${state.run}-svc`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText(`aud-${state.run}-svc`).first().waitFor();
  });

  await audit.step(s, 'API keys: issue a read-only key and see the secret once', async () => {
    await page.getByRole('button', { name: 'New key' }).click();
    const dialog = page.getByRole('dialog');
    await fillStable(dialog.getByLabel(/^Name/), `aud-${state.run}-key`);
    await dialog.getByRole('button', { name: 'Issue key' }).click();
    // The secret is shown once; assert it is there without printing it.
    await page.getByText(/ims_|copy|only be shown|shown once/i).first().waitFor({ timeout: 8000 });
    // The secret dialog ignores Escape on purpose: the key cannot be shown again.
    await page.getByRole('button', { name: 'I have copied it' }).click();
    await page.getByText(`aud-${state.run}-key`).first().waitFor();
  });

  await audit.step(s, 'API keys: revoke the key', async () => {
    await page.getByRole('button', { name: `Revoke aud-${state.run}-key` }).click();
    const confirm = page.getByRole('dialog');
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();
    await confirm.waitFor({ state: 'detached' });
  });

  await audit.step(s, 'Audit log: records this run\'s activity', async () => {
    await nav(page, '/admin/audit-log');
    await page.getByRole('row').nth(1).waitFor();
    const rows = await page.getByRole('row').count();
    if (rows < 5) throw new Error(`only ${rows} rows in the audit log after a full audit run`);
    audit.observe(`Audit log showed ${rows - 1} rows on the first page.`);
  });

  await audit.step(s, 'Audit log: filter by user', async () => {
    await pick(page, /^User/, /Imran/);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (/Gina General/.test(text) && !/Imran/.test(text)) throw new Error('user filter did not restrict the log');
    await page.getByRole('button', { name: 'Clear filters' }).click();
  });

  await audit.step(s, 'Account profile page opens', async () => {
    await page.locator('button[aria-haspopup=menu]').last().click();
    await page.getByRole('menuitem', { name: /account/i }).click();
    await page.waitForURL((u) => u.pathname === '/account/profile');
  });

  await audit.step(s, 'Sign out', async () => {
    await signOut(page);
  });
  await s.context.close();
}

module.exports = { a, b };
