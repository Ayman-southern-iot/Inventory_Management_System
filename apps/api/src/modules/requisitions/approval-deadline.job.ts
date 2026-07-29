import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'kysely';
import { ApprovalAction, ApprovalStage, RequisitionStatus } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/**
 * Task 3.9 — the approval deadline reminder.
 *
 * Runs every fifteen minutes rather than once a day so a deadline that passes at 09:05 is
 * noticed the same morning. The acceptance criterion is that a deadline passing while nobody
 * is logged in still produces the reminder, which is exactly why this is a scheduled job
 * reading the database rather than anything triggered by a user's session.
 *
 * Repeats every 24 hours until acted on: `last_reminded_at` is what stops it becoming noise
 * while still nagging an approver who ignores it.
 *
 * Delivery is a log line for now — OQ-10 says there is no SMTP relay, and the in-app
 * notification table arrives with the rest of Phase 03's notification work. The query, the
 * schedule and the repeat window are the parts worth getting right now; swapping the log for
 * an insert is a one-line change.
 */
const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

export interface OverdueApproval {
  approval_id: string;
  requisition_id: string;
  requisition_no: string;
  assigned_user_id: string;
  assignee_name: string;
  approval_deadline: Date | string;
  stage: string;
}

@Injectable()
export class ApprovalDeadlineJob {
  private readonly logger = new Logger(ApprovalDeadlineJob.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'approval-deadlines' })
  async run(): Promise<number> {
    return this.remind();
  }

  /** Exposed so a test or an admin endpoint can run it on demand. Returns the reminder count. */
  async remind(): Promise<number> {
    const due = await this.findOverdueApprovals();
    if (due.length === 0) return 0;

    for (const row of due) {
      this.logger.warn(
        `Approval overdue: ${row.requisition_no} waiting on ${row.assignee_name} ` +
          `(${row.stage}) since ${new Date(row.approval_deadline).toISOString().slice(0, 10)}`,
      );
    }

    await this.markReminded(due.map((row) => row.approval_id));
    this.logger.warn(`Sent ${due.length} approval deadline reminder(s)`);
    return due.length;
  }

  /**
   * Still pending, past its deadline, and on the stage that is actually actionable right now —
   * reminding an approver while the requisition is still with the IM would be telling them to
   * do something they cannot yet do.
   */
  private async findOverdueApprovals(): Promise<OverdueApproval[]> {
    const cutoff = new Date(Date.now() - REMIND_EVERY_MS);

    const result = await sql<OverdueApproval>`
      SELECT
        ra.id                   AS approval_id,
        r.id                    AS requisition_id,
        r.requisition_no,
        ra.assigned_user_id,
        u.full_name             AS assignee_name,
        r.approval_deadline,
        ra.stage::text          AS stage
      FROM requisition_approvals ra
      JOIN requisitions r ON r.id = ra.requisition_id
      JOIN users u        ON u.id = ra.assigned_user_id
      WHERE ra.action = ${ApprovalAction.PENDING}
        AND r.approval_deadline IS NOT NULL
        AND r.approval_deadline < current_date
        AND (
          (ra.stage = ${ApprovalStage.INVENTORY_MANAGER}::approval_stage
             AND r.status = ${RequisitionStatus.IM_REVIEW}::requisition_status)
          OR
          (ra.stage = ${ApprovalStage.APPROVER}::approval_stage
             AND r.status = ${RequisitionStatus.AWAITING_APPROVAL}::requisition_status)
        )
        AND (ra.last_reminded_at IS NULL OR ra.last_reminded_at < ${cutoff})
      ORDER BY r.approval_deadline
    `.execute(this.db);

    return result.rows;
  }

  private async markReminded(approvalIds: string[]): Promise<void> {
    if (approvalIds.length === 0) return;
    await this.db
      .updateTable('requisition_approvals')
      .set({ last_reminded_at: new Date() })
      .where('id', 'in', approvalIds)
      .execute();
  }
}
