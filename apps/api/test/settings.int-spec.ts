import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  InternalSettingKey,
  Role,
  SettingKey,
  type ApproverSlot,
  type AuditAction,
  type Setting,
} from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import {
  createDepartment,
  createUser,
  login,
  resetData,
  restoreSeededSettings,
} from './factories';
import { ApproverSlotsService } from '../src/modules/settings/approver-slots.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';

describe('settings', () => {
  let ctx: TestApp;
  let settings: SettingsService;
  let approverSlots: ApproverSlotsService;
  let audit: AuditService;

  beforeAll(async () => {
    ctx = await createTestApp();
    settings = ctx.app.get(SettingsService);
    approverSlots = ctx.app.get(ApproverSlotsService);
    audit = ctx.app.get(AuditService);
  });

  afterAll(async () => {
    // This file raises EXPENSE_THRESHOLD_BDT by 1,000 relative to whatever it finds, so the
    // leak drifts rather than sitting at one value — harder to spot than the fixed 9,999 in
    // audit.int-spec, same consequence for whatever boots next.
    await restoreSeededSettings(ctx);
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
  });

  async function adminClient(): Promise<{ id: string; client: HttpClient }> {
    const http = httpClient(ctx.app);
    const admin = await createUser(ctx.db, { roles: [Role.ADMIN] });
    const session = await login(http, admin.email);
    return { id: admin.id, client: http.as(session.accessToken) };
  }

  describe('expense threshold', () => {
    it('is visible to SettingsService.get() without a restart (plan 0.4)', async () => {
      const admin = await adminClient();
      // Read first: this puts the old value in the cache, which is the thing that could
      // swallow the change. Without the priming read the test would pass on a cold cache.
      const before = await settings.get(SettingKey.EXPENSE_THRESHOLD_BDT);
      const next = before + 7_500;

      const response = await admin.client
        .put('/admin/settings')
        .send({ key: SettingKey.EXPENSE_THRESHOLD_BDT, value: next });

      expect(response.status).toBe(200);
      expect((response.body as Setting).value).toBe(next);
      expect(await settings.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(next);
    });

    it('persists the new value and records who changed it', async () => {
      const admin = await adminClient();
      const next = (await settings.get(SettingKey.EXPENSE_THRESHOLD_BDT)) + 1_000;

      await admin.client
        .put('/admin/settings')
        .send({ key: SettingKey.EXPENSE_THRESHOLD_BDT, value: next });

      const row = await ctx.db
        .selectFrom('app_settings')
        .where('key', '=', SettingKey.EXPENSE_THRESHOLD_BDT)
        .select(['value', 'updated_by'])
        .executeTakeFirstOrThrow();
      expect(row.value).toBe(next);
      expect(row.updated_by).toBe(admin.id);
    });

    it('lists every registered setting with the metadata the admin panel renders from', async () => {
      const admin = await adminClient();

      const response = await admin.client.get('/admin/settings');

      expect(response.status).toBe(200);
      const keys = (response.body as Setting[]).map((s) => s.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          SettingKey.EXPENSE_THRESHOLD_BDT,
          SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD,
          SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
        ]),
      );
      for (const setting of response.body as Setting[]) {
        expect(setting.kind).toEqual(expect.any(String));
        expect(setting.labelKey).toEqual(expect.any(String));
      }
    });
  });

  describe('rejected updates', () => {
    it.each([
      ['an unknown key', { key: 'EXPENSE_THRESHOLD_USD', value: 1 }],
      ['a negative threshold', { key: SettingKey.EXPENSE_THRESHOLD_BDT, value: -1 }],
      ['a non-integer threshold', { key: SettingKey.EXPENSE_THRESHOLD_BDT, value: 1500.5 }],
      ['a threshold that is not a number', { key: SettingKey.EXPENSE_THRESHOLD_BDT, value: 'lots' }],
      ['an approver slot count above the maximum', {
        key: SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD,
        value: 3,
      }],
      ['an approver slot count below the minimum', {
        key: SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
        value: 0,
      }],
    ])('rejects %s with VALIDATION_FAILED', async (_label, body) => {
      const admin = await adminClient();

      const response = await admin.client.put('/admin/settings').send(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('leaves the stored value untouched after a rejected update', async () => {
      const admin = await adminClient();
      const before = await settings.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD);

      await admin.client
        .put('/admin/settings')
        .send({ key: SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD, value: 99 });

      expect(await settings.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD)).toBe(before);
    });
  });

  describe('approver slots', () => {
    it('refuses a user who does not hold APPROVER', async () => {
      const admin = await adminClient();
      const notAnApprover = await createUser(ctx.db, { roles: [Role.INVENTORY_MANAGER] });

      const response = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: notAnApprover.id });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCode.CONFLICT);

      const rows = await ctx.db.selectFrom('approver_slots').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    it('refuses a deactivated approver', async () => {
      const admin = await adminClient();
      const retired = await createUser(ctx.db, { roles: [Role.APPROVER], isActive: false });

      const response = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: retired.id });

      expect(response.status).toBe(409);
    });

    it('refuses a slot number outside the modelled range', async () => {
      const admin = await adminClient();
      const approver = await createUser(ctx.db, { roles: [Role.APPROVER] });

      const response = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 3, userId: approver.id });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('keeps a global slot and a department slot with the same number side by side (OQ-02)', async () => {
      const admin = await adminClient();
      const department = await createDepartment(ctx.db);
      const globalApprover = await createUser(ctx.db, { roles: [Role.APPROVER] });
      const departmentApprover = await createUser(ctx.db, { roles: [Role.APPROVER] });

      const first = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: globalApprover.id });
      expect(first.status).toBe(200);

      const second = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: department.id, slotNo: 1, userId: departmentApprover.id });
      expect(second.status).toBe(200);

      // Two partial unique indexes, not one composite: the department row must not evict the
      // company-wide default for the same slot number.
      const slots = second.body as ApproverSlot[];
      expect(slots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ departmentId: null, slotNo: 1, userId: globalApprover.id }),
          expect.objectContaining({
            departmentId: department.id,
            slotNo: 1,
            userId: departmentApprover.id,
          }),
        ]),
      );

      const rows = await ctx.db.selectFrom('approver_slots').selectAll().execute();
      expect(rows).toHaveLength(2);
    });

    it('replaces rather than duplicates when the same slot is set twice', async () => {
      const admin = await adminClient();
      const first = await createUser(ctx.db, { roles: [Role.APPROVER] });
      const second = await createUser(ctx.db, { roles: [Role.APPROVER] });

      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: first.id });
      const response = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: second.id });

      expect(response.status).toBe(200);
      const rows = await ctx.db.selectFrom('approver_slots').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(second.id);
    });

    it('clears a slot when the assignment is set to nobody', async () => {
      const admin = await adminClient();
      const approver = await createUser(ctx.db, { roles: [Role.APPROVER] });
      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: approver.id });

      const cleared = await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: null });

      expect(cleared.status).toBe(200);
      const rows = await ctx.db.selectFrom('approver_slots').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    it('resolves a department override ahead of the global default (OQ-02)', async () => {
      const admin = await adminClient();
      const department = await createDepartment(ctx.db);
      const globalApprover = await createUser(ctx.db, { roles: [Role.APPROVER] });
      const departmentApprover = await createUser(ctx.db, { roles: [Role.APPROVER] });

      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: globalApprover.id });
      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: department.id, slotNo: 1, userId: departmentApprover.id });

      expect(await approverSlots.resolveForDepartment(department.id, 1)).toEqual([
        departmentApprover.id,
      ]);
      expect(await approverSlots.resolveForDepartment(null, 1)).toEqual([globalApprover.id]);
    });

    it('mixes a department override with a global default across two slots (OQ-02)', async () => {
      const admin = await adminClient();
      const department = await createDepartment(ctx.db);
      const globalOne = await createUser(ctx.db, { roles: [Role.APPROVER] });
      const globalTwo = await createUser(ctx.db, { roles: [Role.APPROVER] });
      const departmentOne = await createUser(ctx.db, { roles: [Role.APPROVER] });

      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 1, userId: globalOne.id });
      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: null, slotNo: 2, userId: globalTwo.id });
      await admin.client
        .put('/admin/settings/approver-slots')
        .send({ departmentId: department.id, slotNo: 1, userId: departmentOne.id });

      // Slot 1 is overridden for the department, slot 2 falls back to the company-wide row.
      expect(await approverSlots.resolveForDepartment(department.id, 2)).toEqual([
        departmentOne.id,
        globalTwo.id,
      ]);
    });

    it('fails loudly when a required slot has nobody in it', async () => {
      await expect(approverSlots.resolveForDepartment(null, 1)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
    });
  });

  /**
   * AUDIT_ENABLED_ACTIONS is stored as a materialised copy of the code-level AUDIT_ACTIONS list,
   * so a release that introduces an action finds it missing from every already-booted database
   * and silently stops recording it. Boot reconciles the two against AUDIT_KNOWN_ACTIONS, which
   * is what tells "this release introduced it" apart from "an admin switched it off".
   */
  describe('audit action reconciliation on boot', () => {
    // Stands in for "the stored list already knew about this one" — always-on, so no admin
    // could have removed it, which makes "still there afterwards" an unambiguous assertion.
    const ALREADY_KNOWN: AuditAction = 'auth.login.success';
    // Introduced by the projects hub, long after the earliest snapshots were written.
    const NEWLY_INTRODUCED: AuditAction = 'project.item.detach';
    // Deliberately *not* always-on: an admin is genuinely allowed to switch this one off, which
    // is what makes the opt-out test an assertion about the union rather than about the
    // always-on guard in set().
    const ADMIN_DISABLED: AuditAction = 'category.create';
    const SNAPSHOT: AuditAction[] = [ALREADY_KNOWN, ADMIN_DISABLED];

    /**
     * Writes both rows behind the application's back, the way a previous release left them.
     * `known: null` reproduces a database that has never seen the bookkeeping row at all —
     * i.e. every database deployed before this change.
     */
    async function storeState(
      enabled: readonly AuditAction[],
      known: readonly AuditAction[] | null,
    ): Promise<void> {
      await ctx.db
        .updateTable('app_settings')
        .set({ value: JSON.stringify(enabled) })
        .where('key', '=', SettingKey.AUDIT_ENABLED_ACTIONS)
        .execute();
      await ctx.db
        .deleteFrom('app_settings')
        .where('key', '=', InternalSettingKey.AUDIT_KNOWN_ACTIONS)
        .execute();
      if (known !== null) {
        await ctx.db
          .insertInto('app_settings')
          .values({ key: InternalSettingKey.AUDIT_KNOWN_ACTIONS, value: JSON.stringify(known) })
          .execute();
      }
      settings.clearCache();
      audit.clearEnabledActionsCache();
    }

    /**
     * The integration suite shares one database across spec files, so a narrowed allow-list left
     * behind here would follow every file that boots after this one — and boot deliberately no
     * longer repairs it, which is the whole point of the change.
     */
    afterEach(async () => {
      await storeState([...AUDIT_ACTIONS], [...AUDIT_ACTIONS]);
    });

    async function storedActions(): Promise<string[]> {
      const row = await ctx.db
        .selectFrom('app_settings')
        .select('value')
        .where('key', '=', SettingKey.AUDIT_ENABLED_ACTIONS)
        .executeTakeFirstOrThrow();
      return row.value as string[];
    }

    async function knownActions(): Promise<string[] | null> {
      const row = await ctx.db
        .selectFrom('app_settings')
        .select('value')
        .where('key', '=', InternalSettingKey.AUDIT_KNOWN_ACTIONS)
        .executeTakeFirst();
      return row ? (row.value as string[]) : null;
    }

    async function countRowsFor(action: AuditAction): Promise<number> {
      const rows = await ctx.db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', action)
        .execute();
      return rows.length;
    }

    it('enables an action the known set has never seen, and only that one', async () => {
      await storeState(SNAPSHOT, SNAPSHOT);

      await settings.seedMissing();

      const stored = await storedActions();
      expect(stored).toContain(NEWLY_INTRODUCED);
      // The snapshot survives intact and in place: this is an append, not a replacement, so an
      // admin's list is never rewritten out from under them.
      expect(stored.slice(0, SNAPSHOT.length)).toEqual(SNAPSHOT);
      // Nothing is added twice, and nothing outside the code-level list creeps in.
      expect(new Set(stored).size).toBe(stored.length);
      expect(stored.every((action) => (AUDIT_ACTIONS as readonly string[]).includes(action))).toBe(
        true,
      );
      // And the reconciliation records what it now knows, so the next boot has a baseline.
      expect(new Set(await knownActions())).toEqual(new Set(AUDIT_ACTIONS));
    });

    it('leaves an already-complete list alone on the next boot', async () => {
      await storeState(SNAPSHOT, SNAPSHOT);
      await settings.seedMissing();
      const afterFirst = await storedActions();

      await settings.seedMissing();

      expect(await storedActions()).toEqual(afterFirst);
    });

    /**
     * The regression test for the flaw this design corrects. An action the admin removed is
     * missing from the enabled list exactly like a brand-new one is; the only thing that tells
     * them apart is that this one is in the known set. Re-enabling it would be a restart
     * overwriting a value an admin changed, which rules/10-no-hardcoding.md forbids outright.
     */
    it('keeps an action the admin disabled disabled, across any number of restarts', async () => {
      const adminsChoice = AUDIT_ACTIONS.filter((action) => action !== ADMIN_DISABLED);
      // The admin edited the list while the system already knew about every current action.
      await storeState(adminsChoice, [...AUDIT_ACTIONS]);

      await settings.seedMissing();
      await settings.seedMissing();
      await settings.seedMissing();

      expect(await storedActions()).not.toContain(ADMIN_DISABLED);
      // Not just the row: the behaviour the row controls. The action is still not recorded.
      await audit.record({
        action: ADMIN_DISABLED,
        entityType: 'category',
        entityId: null,
        entityRef: 'Opt-out probe',
        summary: 'Created a category',
      });
      expect(await countRowsFor(ADMIN_DISABLED)).toBe(0);
    });

    /**
     * The first boot after this change on a database that predates the known set. Seeding it
     * from AUDIT_ACTIONS would declare everything already known and leave the newer action off
     * forever, which is the bug being fixed; it is seeded from the stored enabled list instead,
     * because that array is what the code knew when it was written.
     */
    it('treats a missing known set as "what was enabled at the time", not as "everything"', async () => {
      await storeState(SNAPSHOT, null);
      expect(await knownActions()).toBeNull();

      await settings.seedMissing();

      expect(await storedActions()).toContain(NEWLY_INTRODUCED);
      expect(await storedActions()).toContain(ALREADY_KNOWN);
      expect(new Set(await knownActions())).toEqual(new Set(AUDIT_ACTIONS));
    });

    /**
     * The behaviour the union exists for. Before reconciliation the stored array is an explicit
     * allow-list that does not mention the action, so AuditService drops the row and a detach
     * leaves no trace at all; afterwards the identical call records.
     */
    it('turns a silently dropped audit row into a recorded one', async () => {
      await storeState(SNAPSHOT, SNAPSHOT);
      const entry = {
        action: NEWLY_INTRODUCED,
        entityType: 'project',
        entityId: null,
        entityRef: 'Reconciliation probe',
        summary: 'Removed a borrow from a project',
      } as const;

      await audit.record(entry);
      expect(await countRowsFor(NEWLY_INTRODUCED)).toBe(0);

      await settings.seedMissing();
      await audit.record(entry);

      expect(await countRowsFor(NEWLY_INTRODUCED)).toBe(1);
    });
  });
});
