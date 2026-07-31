import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Role, type ApproverSlot, type SetApproverSlotInput } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, NotFoundError } from '../../common/errors';
import { SelfApprovalNoSubstituteError } from '../requisitions/requisitions.errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';

/**
 * OPEN QUESTION: OQ-02 — approver slots resolve department-first, then fall back to the
 * company-wide row (`department_id IS NULL`). If OQ-02 comes back as "company-wide only",
 * the department rows simply stop being created and this resolution still works.
 */
@Injectable()
export class ApproverSlotsService {
  private readonly logger = new Logger(ApproverSlotsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ApproverSlot[]> {
    const rows = await this.db
      .selectFrom('approver_slots')
      .leftJoin('departments', 'departments.id', 'approver_slots.department_id')
      .leftJoin('users', 'users.id', 'approver_slots.user_id')
      .select([
        'approver_slots.department_id',
        'approver_slots.slot_no',
        'approver_slots.user_id',
        'departments.name as department_name',
        'users.full_name as user_name',
        // Surfacing this lets the admin panel highlight "this slot's holder is deactivated"
        // without making the user submit a requisition to find out (Phase 05 bug).
        'users.is_active as user_is_active',
      ])
      .orderBy('departments.name')
      .orderBy('approver_slots.slot_no')
      .execute();

    return rows.map((r) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      slotNo: r.slot_no as 1 | 2,
      userId: r.user_id,
      userName: r.user_name,
      isActive: r.user_is_active,
    }));
  }

  async set(input: SetApproverSlotInput, context: AuditContext): Promise<ApproverSlot[]> {
    if (input.userId) await this.assertIsActiveApprover(input.userId);
    if (input.departmentId) await this.assertDepartmentExists(input.departmentId);

    // The two partial unique indexes mean the global and per-department rows need different
    // conflict targets; an upsert cannot express both, so this is delete-then-insert inside
    // one transaction.
    await this.db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom('approver_slots')
        .where('slot_no', '=', input.slotNo)
        .where((eb) =>
          input.departmentId === null
            ? eb('department_id', 'is', null)
            : eb('department_id', '=', input.departmentId),
        )
        .execute();

      // A null user clears the slot rather than leaving a row pointing at nobody.
      if (input.userId !== null) {
        await tx
          .insertInto('approver_slots')
          .values({
            department_id: input.departmentId,
            slot_no: input.slotNo,
            user_id: input.userId,
            updated_by: context.actorId,
          })
          .execute();
      }

      await this.audit.record(
        {
          action: input.userId === null ? 'approver_slot.clear' : 'approver_slot.assign',
          entityType: 'approver_slot',
          entityId: `${input.departmentId ?? 'global'}:${input.slotNo}`,
          entityRef: `${input.departmentId ?? 'global'} slot ${input.slotNo}`,
          summary:
            input.userId === null
              ? `Cleared approver slot ${input.slotNo} ${input.departmentId ? `for department ${input.departmentId}` : 'globally'}`
              : `Assigned approver slot ${input.slotNo} ${input.departmentId ? `for department ${input.departmentId}` : 'globally'}`,
          metadata: {
            departmentId: input.departmentId,
            slotNo: input.slotNo,
            userId: input.userId,
          },
        },
        context,
        tx,
      );
    });

    return this.list();
  }

  /**
   * Resolution used by Phase 03 when a requisition is submitted.
   *
   * `excludeUserId` is the requester. `requirements §10` (docs/reference/10-permissions.md:19)
   * forbids anyone approving their own requisition and says the system "skips to the next
   * configured approver and logs the substitution".
   */
  async resolveForDepartment(
    departmentId: string | null,
    slotCount: number,
    excludeUserId?: string,
  ): Promise<string[]> {
    const rows = await this.db
      .selectFrom('approver_slots')
      // The inner join makes a deactivated slot holder invisible to submit. Without this,
      // a slot row whose `user_id` points at a deactivated user would silently win the
      // approval assignment and the requisition would be tracked under someone who can
      // never act on it (Phase 05 — admin deactivated seed users without re-saving slots).
      .innerJoin('users', 'users.id', 'approver_slots.user_id')
      .select(['approver_slots.department_id', 'approver_slots.slot_no', 'approver_slots.user_id'])
      .where('users.is_active', '=', true)
      // Deliberately no `slot_no <= slotCount` ceiling. The strict loop below still fills the
      // first `slotCount` slots and still reports an unassigned one by number, but a
      // substitution has to be able to reach a slot beyond the ceiling to find its candidate.
      .where((eb) =>
        departmentId === null
          ? eb('approver_slots.department_id', 'is', null)
          : eb.or([
              eb('approver_slots.department_id', '=', departmentId),
              eb('approver_slots.department_id', 'is', null),
            ]),
      )
      // NULLS FIRST puts the company-wide default ahead of the department override, so the
      // loop below overwrites it. Ordering in SQL rather than with a JS comparator, because
      // a comparator that only inspects one operand has engine-defined behaviour.
      .orderBy(sql`approver_slots.department_id NULLS FIRST`)
      .execute();

    const bySlot = new Map<number, string>();
    for (const slot of rows) {
      if (slot.user_id) bySlot.set(slot.slot_no, slot.user_id);
    }

    const resolved: string[] = [];
    for (let slotNo = 1; slotNo <= slotCount; slotNo += 1) {
      const userId = bySlot.get(slotNo);
      if (!userId) {
        throw new ConflictError(
          `Approver slot ${slotNo} is not assigned, or its holder is inactive. ` +
            `An administrator must set it before requisitions can be submitted.`,
        );
      }
      resolved.push(userId);
    }

    if (excludeUserId === undefined || !resolved.includes(excludeUserId)) return resolved;

    // The requester holds one of the slots. Skip them and stand someone else in.
    //
    // OPEN QUESTION: OQ-07 — the spec mandates "skip and substitute" but leaves the substitute
    // undefined. "The next configured approver" cannot mean only the next slot: `slot_no` is
    // constrained to (1, 2) by migration 0004, so when both slots are in use there is no next
    // one and every above-threshold requisition raised by an approver would be unsubmittable.
    //
    // So the pool is the remaining configured slots first — deterministic, and what an admin
    // would expect — then any other active approver, oldest account first for stability. The
    // approver *count* is never reduced: dropping to one approver because the requester happened
    // to hold a slot would quietly weaken the control the threshold exists to enforce.
    const spare = [
      ...[...bySlot.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([slotNo]) => slotNo > slotCount)
        .map(([, userId]) => userId),
      ...(await this.otherActiveApprovers(excludeUserId)),
    ];

    const substituted = resolved.map((userId) => {
      if (userId !== excludeUserId) return userId;
      const replacement = spare.find(
        (candidate) => candidate !== excludeUserId && !resolved.includes(candidate),
      );
      // Its own typed error, not a bare ConflictError: `submit` wraps any failure out of this
      // method in ApproverSlotUnassignedError, which would tell an admin to fill in a slot that
      // is already filled. Same trap SubthresholdApproverUnassignedError was created to escape.
      if (!replacement) throw new SelfApprovalNoSubstituteError('approver');
      // Remove it so a second occupied slot does not draw the same substitute twice.
      spare.splice(spare.indexOf(replacement), 1);
      this.logger.log(
        `Approver substitution: requester ${excludeUserId} holds a slot on their own ` +
          `requisition; substituted ${replacement} (requirements §10).`,
      );
      return replacement;
    });

    return substituted;
  }

  /**
   * Active users holding the approver role, excluding one. Oldest account first so the same
   * requisition resolves the same substitute on a retry rather than picking at random.
   */
  private async otherActiveApprovers(excludeUserId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .where('users.is_active', '=', true)
      .where('user_roles.role', '=', Role.APPROVER)
      .where('users.id', '!=', excludeUserId)
      .select('users.id')
      .orderBy('users.created_at')
      .execute();
    return rows.map((row) => row.id);
  }

  private async assertIsActiveApprover(userId: string): Promise<void> {
    const row = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .where('users.id', '=', userId)
      .where('users.is_active', '=', true)
      .where('user_roles.role', '=', Role.APPROVER)
      .select('users.id')
      .executeTakeFirst();

    if (!row) {
      throw new ConflictError('That user is not an active approver');
    }
  }

  private async assertDepartmentExists(departmentId: string): Promise<void> {
    const row = await this.db
      .selectFrom('departments')
      .where('id', '=', departmentId)
      .select('id')
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Department');
  }
}
