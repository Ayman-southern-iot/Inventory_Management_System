// GENERAL (every user holds it): browse stock, projects, borrow, requisitions, own queues.
//
// Two phases, because a proposed project is "Awaiting acceptance" and is not offered in the borrow
// or requisition forms until the IM accepts it. Phase a proposes the project; the IM accepts it;
// phase b borrows and raises requisitions against it. What these leave in `state` is what the
// IM, approver and admin phases act on.
const { CONFIG, nav, heading, pick, isoDatePlusDays, signIn, signOut, fillStable } = require('../lib');

/** Fill the requisition form. `submit` true submits for approval, false saves a draft. */
async function fillRequisition(page, { project, reason, item, qty, price, submit }) {
  await page.getByRole('button', { name: 'New requisition' }).first().click();
  await page.waitForURL((u) => u.pathname === '/requisitions/new');
  await page.waitForLoadState('networkidle');
  await pick(page, /Department/);
  if (project) await pick(page, /^Project/, project);
  await page.getByLabel(/Reason/).fill(reason);
  await page.getByLabel('Approval deadline').click();
  const popover = page.getByRole('dialog', { name: 'Approval deadline' });
  // Day buttons are the only ones with aria-pressed; the hour and minute buttons are bare numbers too.
  await popover.locator('button[aria-pressed]:not([disabled])').last().click();
  await popover.getByRole('button', { name: 'Set deadline' }).click();
  await page.getByLabel('Item 1').fill(item);
  await page.getByLabel('Quantity 1').fill(String(qty));
  await page.getByLabel('Unit price (BDT) 1').fill(String(price));
  await page.getByRole('button', { name: submit ? 'Submit for approval' : 'Save draft' }).click();
}

async function a(audit, state) {
  const s = await audit.newRole('GENERAL', 'general');
  const { page } = s;
  state.projectName = `AUD-${state.run}-Falcon`;

  await audit.step(s, 'Sign in with email and password, land on the dashboard', async () => {
    await signIn(page, 'general');
    await heading(page, 'Dashboard');
  });

  await audit.step(s, 'Inventory: search narrows the list', async () => {
    await nav(page, '/inventory');
    await page.getByLabel('Search').fill('Lenovo');
    await page.getByText('Lenovo ThinkPad T14').first().waitFor();
    await page.waitForTimeout(800);
    if ((await page.getByText('NVIDIA RTX 4090').count()) !== 0) throw new Error('search for "Lenovo" still shows the NVIDIA row');
    await page.getByLabel('Search').fill('');
  });

  await audit.step(s, 'Inventory: "In stock only" hides zero-stock products', async () => {
    await page.getByLabel('In stock only').check();
    await page.waitForTimeout(800);
    if ((await page.getByText('Office chair').count()) !== 0) throw new Error('Office chair (0 on hand) still listed');
    await page.getByLabel('In stock only').uncheck();
  });

  await audit.step(s, 'Product detail: totals and locations are shown', async () => {
    await page.getByText('Lenovo ThinkPad T14').first().click();
    await heading(page, 'Lenovo ThinkPad T14');
    for (const word of ['AVAILABLE', 'Locations']) {
      if ((await page.getByText(word).count()) === 0) throw new Error(`"${word}" missing on product page`);
    }
  });

  await audit.step(s, 'Projects: propose a project (it waits for acceptance)', async () => {
    await nav(page, '/projects');
    await page.getByRole('button', { name: 'New project' }).first().click();
    await fillStable(page.getByLabel(/Project name/), state.projectName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByText(state.projectName).first().waitFor();
    await page.getByText('Awaiting acceptance').first().waitFor();
  });

  await audit.step(s, 'Projects: open the project detail page', async () => {
    await page.getByText(state.projectName).first().click();
    await heading(page, state.projectName);
  });

  await audit.step(
    s,
    'Borrow dialog: a not-yet-accepted project is not offered',
    async () => {
      await nav(page, '/inventory');
      await page.getByText('Lenovo ThinkPad T14').first().click();
      await page.getByRole('button', { name: 'Borrow', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const options = await dialog.getByLabel(/^Project/).first().locator('option').allInnerTexts();
      if (options.some((o) => o.includes(state.projectName))) throw new Error('an unaccepted project is selectable');
      await page.keyboard.press('Escape');
    },
    { observe: 'By design: the dialog lists only accepted projects and says nothing about a pending one.' },
  );

  await audit.step(s, 'Requisition: save a draft (no project)', async () => {
    await nav(page, '/my-requisitions');
    await fillRequisition(page, {
      reason: `AUD-${state.run} draft requisition`,
      item: `AUD-${state.run} Draft item`,
      qty: 1,
      price: 500,
      submit: false,
    });
    await page.waitForLoadState('networkidle');
  });

  await audit.step(s, 'My requisitions: the Drafts tab holds the draft', async () => {
    await nav(page, '/my-requisitions');
    await page.getByRole('button', { name: 'Drafts' }).click();
    // The list shows reference, project, amount and status, not the reason text.
    await page.getByText(/REQ-\d+-GINA/).first().waitFor();
  });

  await audit.step(s, 'Notifications: the bell opens', async () => {
    const bell = page.getByRole('button', { name: /notification/i }).first();
    await bell.click();
    const panel = page.getByText('Mark all as read');
    await panel.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (await panel.isVisible()) {
      audit.observe('Escape does not close the notification panel (a bell click does).');
      await bell.click();
    }
  });

  await audit.step(
    s,
    'Permission: /admin/users is not reachable',
    async () => {
      await page.goto(`${CONFIG.base}/admin/users`, { waitUntil: 'networkidle' });
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      if (/New user/.test(text)) throw new Error('GENERAL can see the Users admin screen');
    },
    { expect4xx: true },
  );

  await audit.step(s, 'Sign out returns to the login page', async () => {
    await signOut(page);
  });

  await s.context.close();
}

async function b(audit, state) {
  const s = await audit.newRole('GENERAL', 'general');
  const { page } = s;

  await audit.step(s, 'Sign in again (a second session for the same person)', async () => {
    await signIn(page, 'general');
    await heading(page, 'Dashboard');
  });

  await audit.step(s, 'Borrow 1 of the audit product against the accepted project', async () => {
    await nav(page, '/inventory');
    await page.getByText(state.productName).first().click();
    await heading(page, state.productName);
    await page.getByRole('button', { name: 'Borrow', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await pick(dialog, /From/);
    await dialog.getByLabel(/Quantity/).fill('1');
    await pick(dialog, /^Project/, state.projectName);
    await dialog.getByLabel('I will return this').check();
    await dialog.getByLabel('Expected back').fill(isoDatePlusDays(7));
    await dialog.getByLabel('Purpose').fill(`AUD-${state.run} sensor rig`);
    await dialog.getByRole('button', { name: 'Borrow', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await audit.step(s, 'My borrowings: the borrow is listed under Pending', async () => {
    await nav(page, '/my-borrowings');
    await page.getByRole('button', { name: 'Pending' }).click();
    await page.getByText(state.productName).first().waitFor();
  });

  await audit.step(s, 'Borrow a second unit with no project', async () => {
    await nav(page, '/inventory');
    await page.getByText(state.productName).first().click();
    await heading(page, state.productName);
    await page.getByRole('button', { name: 'Borrow', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await pick(dialog, /From/);
    await dialog.getByLabel(/Quantity/).fill('1');
    await dialog.getByLabel('Expected back').fill(isoDatePlusDays(3)); // required while "I will return this" is ticked
    await dialog.getByLabel('Purpose').fill(`AUD-${state.run} short loan`);
    await dialog.getByRole('button', { name: 'Borrow', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  });

  // Four requisitions with four different fates, so each downstream role has something to do:
  //   A 3,600  approved by the sub-threshold approver, then BOM, money, purchase
  //   B 1,800  rejected by the approver (with a note)
  //   C   900  rejected by the IM at review
  //   D 20,000 at or above the 15,000 threshold: needs Approver 1 and Approver 2
  state.reqs = state.reqs || {};
  const plan = [
    ['A', 3, 1200, 'Sensor board'],
    ['B', 2, 900, 'Relay module'],
    ['C', 1, 900, 'Spare cable'],
    ['D', 20, 1000, 'Dev kit'],
  ];
  for (const [key, qty, price, item] of plan) {
    await audit.step(s, `Requisition ${key}: submit ${qty} x ${price} BDT for approval`, async () => {
      await nav(page, '/my-requisitions');
      await fillRequisition(page, {
        project: key === 'A' ? state.projectName : undefined,
        reason: `AUD-${state.run} requisition ${key}`,
        item: `AUD-${state.run} ${item}`,
        qty,
        price,
        submit: true,
      });
      await page.waitForURL((u) => /^\/requisitions\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 15000 });
      const ref = (await page.getByRole('heading', { name: /^REQ-\d+/ }).first().innerText()).trim();
      state.reqs[key] = { path: new URL(page.url()).pathname, ref, total: qty * price };
    });
  }
  state.requisitionPath = state.reqs.A && state.reqs.A.path;

  await audit.step(s, 'Requisition detail: tracker shows the Inventory Manager stage', async () => {
    await page.getByRole('heading', { name: /^REQ-\d+/ }).first().waitFor();
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/Inventory Manager/i.test(text)) throw new Error('no Inventory Manager node: ' + text.slice(0, 200));
  });

  await s.context.close();
}

/** After the IM has approved the borrow and reviewed the requisition. */
async function c(audit, state) {
  const s = await audit.newRole('GENERAL', 'general');
  const { page } = s;
  await audit.step(s, 'Sign in a third time', async () => {
    await signIn(page, 'general');
    await heading(page, 'Dashboard');
  });
  await audit.step(s, 'My borrowings: the approved borrow is now Out', async () => {
    await nav(page, '/my-borrowings');
    await page.getByRole('button', { name: 'Out' }).click();
    await page.getByText(state.productName).first().waitFor();
  });
  await audit.step(s, 'Project detail shows the borrowed product', async () => {
    await nav(page, '/projects');
    await page.getByText(state.projectName).first().click();
    await heading(page, state.projectName);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!text.includes(state.productName)) throw new Error('borrowed product not on the project page: ' + text.slice(0, 200));
  });
  const refs = state.reqs || {};

  await audit.step(s, 'My requisitions: B shows as rejected, and the approver\'s note is readable', async () => {
    await nav(page, '/my-requisitions');
    await page.getByRole('button', { name: 'Rejected' }).click();
    await page.getByText(refs.B.ref, { exact: true }).first().click();
    await page.getByRole('heading', { name: refs.B.ref }).first().waitFor();
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/second quote/.test(text)) {
      // The note sits behind a "See why" control on the tracker.
      await page.getByText(/See why/i).first().click();
      await page.getByText(/second quote/).first().waitFor({ timeout: 5000 });
    }
  });

  await audit.step(s, 'My requisitions: A has been bought and verified (the requester sees the lifecycle)', async () => {
    await nav(page, '/my-requisitions');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByText(refs.A.ref, { exact: true }).first().click();
    await page.getByRole('heading', { name: refs.A.ref }).first().waitFor();
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/Purchased|Verified|In stock/.test(text)) throw new Error('lifecycle for A shows no purchase stage');
  });

  await audit.step(s, 'Sign out returns to the login page', async () => {
    await signOut(page);
  });
  await s.context.close();
}

module.exports = { a, b, c };
