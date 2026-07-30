import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Role, type ApproverSlot, type SetApproverSlotInput } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, NotFoundError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';

/**
 * OPEN QUESTION: OQ-02 — approver slots resolve department-first, then fall back to the
 * company-wide row (`department_id IS NULL`). If OQ-02 comes back as "company-wide only",
 * the department rows simply stop being created and this resolution still works.
 */
@Injectable()
export class ApproverSlotsService {
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

  /** Resolution used by Phase 03 when a requisition is submitted. */
  async resolveForDepartment(departmentId: string | null, slotCount: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('approver_slots')
      // The inner join makes a deactivated slot holder invisible to submit. Without this,
      // a slot row whose `user_id` points at a deactivated user would silently win the
      // approval assignment and the requisition would be tracked under someone who can
      // never act on it (Phase 05 — admin deactivated seed users without re-saving slots).
      .innerJoin('users', 'users.id', 'approver_slots.user_id')
      .select(['approver_slots.department_id', 'approver_slots.slot_no', 'approver_slots.user_id'])
      .where('users.is_active', '=', true)
      .where('approver_slots.slot_no', '<=', slotCount)
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
    return resolved;
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
