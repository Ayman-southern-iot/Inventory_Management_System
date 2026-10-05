// APPROVER: Ayesha is Approver 1 and the sub-threshold approver; Farhan is Approver 2.
const { CONFIG, nav, heading, signIn, signOut } = require('../lib');

async function openFromApprovals(page, ref) {
  await nav(page, '/approvals');
  await page.getByText(ref, { exact: true }).first().click();
  await page.getByRole('heading', { name: ref }).first().waitFor();
}

async function ayesha(audit, state) {
  const s = await audit.newRole('APPROVER', 'approver1');
  const { page } = s;
  const refs = state.reqs || {};

  await audit.step(s, 'Sign in, land on the dashboard', async () => {
    await signIn(page, 'approver1');
    await heading(page, 'Dashboard');
  });

  await audit.step(s, 'Approvals: "Waiting on me" lists A, B and D', async () => {
    await nav(page, '/approvals');
    for (const key of ['A', 'B', 'D']) await page.getByText(refs[key].ref, { exact: true }).first().waitFor();
  });

  await audit.step(s, 'Approvals: C (rejected at IM review) is not waiting on the approver', async () => {
    if ((await page.getByText(refs.C.ref, { exact: true }).count()) !== 0) throw new Error('C is listed as waiting on the approver');
  });

  await audit.step(s, 'Requisition A: approve', async () => {
    await openFromApprovals(page, refs.A.ref);
    await page.getByRole('button', { name: /^Approve/ }).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByText(/Approved/).first().waitFor();
  });

  await audit.step(s, 'Requisition B: reject with a note', async () => {
    await openFromApprovals(page, refs.B.ref);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Note').fill('AUD: price too high, get a second quote');
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText(/Rejected/).first().waitFor();
  });

  await audit.step(s, 'Requisition D: approve as Approver 1 (Approver 2 still to act)', async () => {
    await openFromApprovals(page, refs.D.ref);
    await page.getByRole('button', { name: /^Approve/ }).first().click();
    await page.waitForLoadState('networkidle');
  });

  await audit.step(s, 'Approvals: the Approved tab holds A and D, the Rejected tab holds B', async () => {
    await nav(page, '/approvals');
    await page.getByRole('button', { name: 'Approved' }).click();
    await page.getByText(refs.A.ref, { exact: true }).first().waitFor();
    await page.getByText(refs.D.ref, { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Rejected' }).click();
    await page.getByText(refs.B.ref, { exact: true }).first().waitFor();
  });

  await audit.step(s, 'Expenses: the report loads and a period can be chosen', async () => {
    await nav(page, '/expenses');
    await page.getByRole('button', { name: 'Last month' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'All time' }).click();
    await page.waitForLoadState('networkidle');
  });

  await audit.step(s, 'Expenses: Download CSV produces a file', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    if (!/\.csv$/i.test(download.suggestedFilename())) throw new Error('not a csv: ' + download.suggestedFilename());
  });

  await audit.step(s, 'Projects: the accepted project is visible', async () => {
    await nav(page, '/projects');
    await page.getByText(state.projectName).first().waitFor();
  });

  await audit.step(s, 'Notifications: the bell shows what was asked of me', async () => {
    const bell = page.getByRole('button', { name: /notification/i }).first();
    await bell.click();
    await page.getByText('Mark all as read').waitFor();
    await bell.click();
  });

  await audit.step(
    s,
    'Permission: Bills of Materials is not reachable',
    async () => {
      await page.goto(`${CONFIG.base}/boms`, { waitUntil: 'networkidle' });
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      if (/New BOM/.test(text)) throw new Error('an approver can see the BOM screen');
    },
    { expect4xx: true },
  );

  await audit.step(s, 'Sign out', async () => {
    await signOut(page);
  });
  await s.context.close();
}

async function farhan(audit, state) {
  const s = await audit.newRole('APPROVER', 'approver2');
  const { page } = s;
  const refs = state.reqs || {};

  await audit.step(s, 'Approver 2 signs in', async () => {
    await signIn(page, 'approver2');
  });

  await audit.step(s, 'Approvals: only D (at or above the threshold) is waiting on Approver 2', async () => {
    await nav(page, '/approvals');
    await page.getByText(refs.D.ref, { exact: true }).first().waitFor();
    if ((await page.getByText(refs.A.ref, { exact: true }).count()) !== 0) throw new Error('A (below threshold) is waiting on Approver 2');
  });

  await audit.step(s, 'Requisition D: approve as Approver 2, completing the chain', async () => {
    await openFromApprovals(page, refs.D.ref);
    await page.getByRole('button', { name: /^Approve/ }).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByText(/Approved/).first().waitFor();
  });

  await audit.step(s, 'Sign out', async () => {
    await signOut(page);
  });
  await s.context.close();
}

module.exports = { ayesha, farhan };
