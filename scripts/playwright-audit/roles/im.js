// INVENTORY_MANAGER: accepts projects, owns the catalogue, stock, borrowing queue, requisition
// review, BOMs and the money stages. Phases follow the work the other roles hand over.
const { CONFIG, nav, heading, pick, toast, signIn, sleep, fillStable } = require('../lib');

/** The dialog's first text input, for create dialogs whose only required field is a name. */
async function fillName(dialog, value) {
  await dialog.locator('input[type=text], input:not([type])').first().fill(value);
}

async function a(audit, state) {
  const s = await audit.newRole('IM', 'im');
  const { page } = s;
  // Storage codes are built from the first three letters of the room and zone names, so rooms that
  // share a prefix collide on 409 (the UI says only "conflicts with the current state"). Lead with
  // the run id, which is unique, so repeated audits do not trip on each other's rooms.
  const room = `${state.run} Audit Room`;
  const productName = `AUD-${state.run} Widget`;
  const zone = `Z${state.run}`;
  const shelf = `S${state.run}`;
  state.productName = productName;
  state.roomName = room;

  await audit.step(s, 'Sign in, land on the dashboard', async () => {
    await signIn(page, 'im');
    await heading(page, 'Dashboard');
  });

  await audit.step(s, 'Projects: accept the project General proposed', async () => {
    await nav(page, '/projects');
    const card = page.locator('li, tr, article, div').filter({ hasText: state.projectName }).filter({ has: page.getByRole('button', { name: 'Accept', exact: true }) }).last();
    await card.getByRole('button', { name: 'Accept', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await sleep(600);
    const stillWaiting = await page.locator('main').filter({ hasText: state.projectName }).getByText('Awaiting acceptance').count();
    if (stillWaiting > 0 && (await page.getByRole('button', { name: 'Accept', exact: true }).count()) > 0) {
      // Other proposed projects from earlier runs may also be waiting; only ours matters.
      const ours = page.getByText(state.projectName).first();
      await ours.waitFor();
    }
  });

  await audit.step(s, 'Categories: add a top-level category (inline form)', async () => {
    await nav(page, '/inventory/categories');
    await page.getByRole('button', { name: 'Add top-level category' }).first().click();
    const input = page.getByPlaceholder('Top-level category name');
    await input.fill(`AUD-${state.run} Category`);
    await input.press('Enter');
    await page.getByText(`AUD-${state.run} Category`).first().waitFor();
  });

  await audit.step(s, 'Locations: create a room', async () => {
    await nav(page, '/inventory/locations');
    await page.getByRole('button', { name: 'New room' }).first().click();
    const dialog = page.getByRole('dialog');
    await fillStable(dialog.getByLabel(/Room name/), room);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.getByText(room).first().waitFor();
  });

  await audit.step(s, 'Locations: add a zone and a compartment to the new room', async () => {
    // Nearest ancestor of the room's own name that holds a New zone button: that is its header.
    // (Filtering divs by text matches every ancestor, and the first button in a list container
    // belongs to the first room, which silently creates the zone in the wrong room.)
    const roomHeader = page.getByText(room, { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space(.)="New zone"]][1]');
    await roomHeader.getByRole('button', { name: 'New zone' }).click();
    await fillStable(page.getByLabel(/Zone name/), zone);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByText(zone, { exact: true }).first().waitFor();
    const zoneHeader = page.getByText(zone, { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space(.)="New compartment"]][1]');
    await zoneHeader.getByRole('button', { name: 'New compartment' }).first().click();
    await fillStable(page.getByLabel(/Compartment code/), shelf);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByText(shelf, { exact: true }).first().waitFor();
  });

  await audit.step(s, 'Products: create a product', async () => {
    await nav(page, '/inventory');
    await page.getByRole('button', { name: 'New product' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Name/).fill(productName);
    await pick(dialog, /^Unit/);
    await dialog.getByRole('button', { name: 'Save product' }).click();
    // Saving does not return to the list: it opens the new product with Receive stock already up.
    await page.waitForURL((u) => /^\/inventory\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 10000 });
    audit.observe('Creating a product opens its page with the Receive stock dialog already open (opening-stock flow).');
  });

  await audit.step(s, 'Products: the new product page opens with 0 on hand', async () => {
    // After Save the app may stay on the list or open the product; handle both and say which.
    await heading(page, productName);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/ON HAND: 0/.test(text)) throw new Error('a new product should start with 0 on hand: ' + text.slice(0, 160));
  });

  await audit.step(s, 'Stock: receive 20 into the new room', async () => {
    // Creating the product usually leaves this dialog open already; open it only if it is not.
    if ((await page.getByRole('dialog', { name: 'Receive stock' }).count()) === 0) {
      // An empty product also shows a second Receive stock button in its empty state.
      await page.getByRole('button', { name: 'Receive stock', exact: true }).first().click();
    }
    const dialog = page.getByRole('dialog', { name: 'Receive stock' });
    await pick(dialog, /Room/, room);
    await pick(dialog, /Zone/);
    await pick(dialog, /Compartment/);
    await dialog.getByLabel(/Quantity/).fill('20');
    await dialog.getByLabel('Note').fill(`AUD-${state.run} opening balance`);
    await dialog.getByRole('button', { name: 'Receive stock' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText(/20/).first().waitFor();
  });

  await audit.step(s, 'Stock: adjust down by 2 with a reason', async () => {
    await page.getByRole('button', { name: 'Adjust stock' }).click();
    const dialog = page.getByRole('dialog');
    await pick(dialog, /Compartment/);
    await dialog.getByLabel(/Adjustment/).fill('-2');
    await dialog.getByLabel(/Reason/).fill(`AUD-${state.run} cycle count`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await audit.step(s, 'Stock: move 1 ThinkPad between its two locations', async () => {
    await nav(page, '/inventory');
    await page.getByLabel('Search').fill('Lenovo');
    await page.getByText('Lenovo ThinkPad T14').first().click();
    await heading(page, 'Lenovo ThinkPad T14');
    await page.getByRole('button', { name: 'Move stock', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const from = dialog.getByLabel(/From/).first();
    const fromOptions = await from.locator('option').evaluateAll((os) => os.filter((o) => o.value).map((o) => o.value));
    await from.selectOption(fromOptions[0]);
    const to = dialog.getByLabel(/^To/).first();
    const toOptions = await to.locator('option').evaluateAll((os) => os.filter((o) => o.value && !o.disabled).map((o) => o.value));
    if (toOptions.length === 0) throw new Error('no destination offered for the move');
    await to.selectOption(toOptions[0]);
    await dialog.getByLabel(/Quantity/).fill('1');
    await dialog.getByRole('button', { name: 'Move stock', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await audit.step(s, 'Inventory: Export CSV downloads a file', async () => {
    await nav(page, '/inventory');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const name = download.suggestedFilename();
    if (!/\.csv$/i.test(name)) throw new Error('export is not a csv: ' + name);
  });

  await audit.step(s, 'Inventory: Export PDF downloads a file', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: 'Export PDF' }).click(),
    ]);
    const name = download.suggestedFilename();
    if (!/\.pdf$/i.test(name)) throw new Error('export is not a pdf: ' + name);
  });

  await audit.step(s, 'Bulk import route shows "Coming soon" (deferred in the UI)', async () => {
    await nav(page, '/inventory/imports');
    await page.getByText('Coming soon').first().waitFor();
    await page.getByText('Choose a file').count().then((n) => {
      if (n > 0) throw new Error('import UI still reachable');
    });
  });

  await s.context.close();
}

/** Open a requisition from the all-requisitions list by its reference. */
async function openRequisition(page, ref) {
  await nav(page, '/all-requisitions');
  await page.getByText(ref, { exact: true }).first().click();
  await page.getByRole('heading', { name: ref }).first().waitFor();
}

async function b(audit, state) {
  const s = await audit.newRole('IM', 'im');
  const { page } = s;
  const refs = state.reqs || {};

  await audit.step(s, 'Sign in a second time', async () => {
    await signIn(page, 'im');
  });

  await audit.step(s, 'Borrowing: approve the short loan (newest pending)', async () => {
    await nav(page, '/borrowing');
    await page.getByRole('button', { name: 'Pending', exact: true }).click();
    const approve = page.getByRole('button', { name: /^Approve BR-/ }).first();
    await approve.waitFor();
    state.shortLoanRef = (await approve.getAttribute('aria-label')).replace('Approve ', '');
    await approve.click();
    await page.waitForLoadState('networkidle');
  });

  await audit.step(s, 'Borrowing: approve the project borrow', async () => {
    await page.waitForTimeout(800);
    const approve = page.getByRole('button', { name: /^Approve BR-/ }).first();
    await approve.waitFor();
    state.projectLoanRef = (await approve.getAttribute('aria-label')).replace('Approve ', '');
    await approve.click();
    await page.waitForLoadState('networkidle');
  });

  await audit.step(s, 'Borrowing: the Out tab lists both loans', async () => {
    await page.getByRole('button', { name: 'Out', exact: true }).click();
    await page.getByText(state.shortLoanRef).first().waitFor();
    await page.getByText(state.projectLoanRef).first().waitFor();
  });

  await audit.step(s, 'Borrowing: search by product narrows the list', async () => {
    await page.getByLabel('Search').fill(state.productName);
    await page.waitForTimeout(800);
    await page.getByText(state.productName).first().waitFor();
    await page.getByLabel('Search').fill('');
  });

  await audit.step(s, 'Borrowing: record the return of the short loan', async () => {
    const row = page.getByText(state.shortLoanRef).first().locator('xpath=ancestor::*[.//button][1]');
    await row.getByRole('button', { name: /return/i }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: /return|confirm|save/i }).last().click();
    await dialog.waitFor({ state: 'detached' });
  });

  await audit.step(s, 'Requisitions: all four are with the IM', async () => {
    await nav(page, '/all-requisitions');
    for (const key of Object.keys(refs)) await page.getByText(refs[key].ref, { exact: true }).first().waitFor();
  });

  for (const key of ['A', 'B', 'D']) {
    await audit.step(s, `Requisition ${key}: IM review, approve without signature`, async () => {
      await openRequisition(page, refs[key].ref);
      await page.getByRole('button', { name: 'Approve without signature' }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
    });
  }

  await audit.step(s, 'Requisition C: IM review, reject with a note', async () => {
    await openRequisition(page, refs.C.ref);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Note').fill('AUD: not needed, already in stock');
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText(/Rejected/i).first().waitFor();
  });

  await audit.step(s, 'Requisitions: the Rejected tab holds C', async () => {
    await nav(page, '/all-requisitions');
    await page.getByRole('button', { name: 'Rejected' }).click();
    await page.getByText(refs.C.ref, { exact: true }).first().waitFor();
  });

  await s.context.close();
}

/** After the approvers: BOMs and the money stages for requisition A, plus a BOM voided for D. */
async function c(audit, state) {
  const s = await audit.newRole('IM', 'im');
  const { page } = s;
  const refs = state.reqs || {};

  await audit.step(s, 'Sign in a third time', async () => {
    await signIn(page, 'im');
  });

  await audit.step(s, 'Requisition A: an approved requisition offers "Generate the BOM"', async () => {
    await openRequisition(page, refs.A.ref);
    await page.getByRole('link', { name: 'Generate the BOM for this requisition' }).waitFor();
    audit.observe('The IM can also "Take it back" on an approved requisition (undo window).');
  });

  await audit.step(s, 'BOM: generate it for A (unit cost and vendor are the only inputs)', async () => {
    await page.getByRole('link', { name: 'Generate the BOM for this requisition' }).click();
    await page.getByRole('heading', { name: 'New BOM' }).first().waitFor();
    await page.getByLabel('Unit cost (BDT)').first().fill('1200');
    await page.getByLabel('Vendor').first().fill(`AUD-${state.run} Vendor`);
    await page.getByRole('button', { name: 'Generate BOM' }).click();
    await page.waitForURL((u) => /^\/boms\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 20000 });
    state.bomA = new URL(page.url()).pathname;
  });

  await audit.step(s, 'BOM detail: totals and the source requisition are shown', async () => {
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/3,600/.test(text)) throw new Error('BOM total 3,600 not shown: ' + text.slice(0, 200));
    if (!text.includes(refs.A.ref)) throw new Error('source requisition not listed on the BOM');
  });

  await audit.step(s, 'BOMs: the list shows it under Live', async () => {
    await nav(page, '/boms');
    await page.getByRole('button', { name: 'Live' }).click();
    await page.getByText(refs.A.ref).first().waitFor();
  });

  await audit.step(s, 'Requisition A: its status reflects the BOM, in the same session', async () => {
    await openRequisition(page, refs.A.ref);
    const send = page.getByRole('button', { name: 'Send to Accounts', exact: true });
    if ((await send.count()) === 0) {
      // Known defect: useBomMutation (features/boms/api.ts) invalidates only the BOM lists, so the
      // cached requisition still says Approved and offers "Generate the BOM" again until a reload.
      audit.observe('DEFECT: after generating a BOM the requisition page, reached in the same session, still shows Approved and "Generate the BOM"; "Send to Accounts" only appears after a full reload (features/boms/api.ts:81-84 does not invalidate the requisition queries).');
      await page.reload({ waitUntil: 'networkidle' });
    }
    await send.waitFor({ timeout: 8000 });
  });

  // The money stages, in the order the requisition page offers them. Each one opens a dialog;
  // the buttons are only offered for the current stage, so a wrong order shows up as a missing button.
  const money = async (buttonName, fill) => {
    await openRequisition(page, refs.A.ref);
    await page.getByRole('button', { name: buttonName, exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await fill(dialog);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
  };

  await audit.step(s, 'Money: Send to Accounts (with a note)', async () => {
    await money('Send to Accounts', (d) => d.getByLabel('Note').fill('AUD: BOM handed over'));
  });

  await audit.step(s, 'Money: record the money received (one payment, whole amount)', async () => {
    await money('Record money received', async (d) => {
      await d.getByLabel('Reference').fill(`AUD-${state.run}-TRX`);
    });
    audit.observe('Instalments are off in this version: the dialog states "Recorded in one payment" and the amount is fixed.');
  });

  await audit.step(s, 'Money: an over-spent purchase is refused with a clear message', async () => {
    await openRequisition(page, refs.A.ref);
    await page.getByRole('button', { name: 'Record a purchase', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Vendor/).fill(`AUD-${state.run} Vendor`);
    await dialog.getByLabel(/^Quantity/).fill('3');
    await dialog.getByLabel(/^Unit cost/).fill('9999');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByText(/more than has been funded/i).waitFor({ timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  await audit.step(s, 'Money: record the purchase at the planned cost', async () => {
    await money('Record a purchase', async (d) => {
      await d.getByLabel(/^Vendor/).fill(`AUD-${state.run} Vendor`);
      await d.getByLabel(/^Invoice number/).fill(`INV-${state.run}`);
      await d.getByLabel(/^Quantity/).fill('3');
      await d.getByLabel(/^Unit cost/).fill('1200');
    });
  });

  await audit.step(s, 'Money: verify the purchase (nothing goes back to Accounts)', async () => {
    await money('Verify purchase', async () => {});
  });

  await audit.step(s, 'Stock: add the purchased item to inventory as a new product', async () => {
    await openRequisition(page, refs.A.ref);
    await page.getByRole('button', { name: 'Add to inventory', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByLabel(/still to receive/).check();
    await dialog.getByLabel(/^Quantity/).fill('3');
    await pick(dialog, /^Room/, state.roomName);
    await pick(dialog, /^Zone/);
    await pick(dialog, /^Compartment/);
    await dialog.getByLabel('It is a new product').check();
    // Storage ID is required by the server for a new product but is not marked required in the form.
    await dialog.getByLabel('Storage ID').fill(`AUD-${state.run.toUpperCase()}`);
    const name = dialog.getByLabel('Product name');
    if (!(await name.inputValue())) await name.fill(`AUD-${state.run} Sensor board`);
    await pick(dialog, /^Category/);
    const unit = dialog.getByLabel('Unit');
    if (!(await unit.inputValue())) await unit.fill('pcs');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
  });

  await audit.step(s, 'Requisition A: the lifecycle reaches In stock', async () => {
    await page.waitForLoadState('networkidle');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!/In stock/i.test(text)) throw new Error('no "In stock" in lifecycle: ' + text.slice(0, 160));
  });

  await audit.step(s, 'BOM: render the PDF for Accounts', async () => {
    await nav(page, '/boms');
    await page.getByRole('button', { name: 'Live' }).click();
    await page.getByText(refs.A.ref).first().click();
    await page.getByRole('button', { name: 'Render PDF' }).click();
    await page.getByText('PDF pending').waitFor({ state: 'detached', timeout: 60000 });
  });

  await audit.step(s, 'BOM: generate one for D, then void it with a reason', async () => {
    await openRequisition(page, refs.D.ref);
    await page.getByRole('link', { name: 'Generate the BOM for this requisition' }).click();
    await page.getByRole('heading', { name: 'New BOM' }).first().waitFor();
    await page.getByLabel('Unit cost (BDT)').first().fill('1000');
    await page.getByLabel('Vendor').first().fill(`AUD-${state.run} Vendor D`);
    await page.getByRole('button', { name: 'Generate BOM' }).click();
    await page.waitForURL((u) => /^\/boms\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 20000 });
    await page.getByRole('button', { name: /void/i }).first().click();
    const dialog = page.getByRole('dialog');
    await fillStable(dialog.getByLabel(/^Reason/), 'AUD: wrong vendor');
    await dialog.getByRole('button').filter({ hasNotText: /Cancel|Close/ }).last().click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });
  });

  await audit.step(s, 'BOMs: the voided BOM is listed under Voided', async () => {
    await nav(page, '/boms');
    await page.getByRole('button', { name: 'Voided' }).click();
    await page.getByText(refs.D.ref).first().waitFor();
  });

  await audit.step(s, 'Expenses: the report loads for the IM and exports', async () => {
    await nav(page, '/expenses');
    await page.getByRole('button', { name: 'All time' }).click();
    await page.waitForLoadState('networkidle');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    if (!/\.csv$/i.test(download.suggestedFilename())) throw new Error('not a csv');
  });

  await s.context.close();
}

module.exports = { a, b, c };
