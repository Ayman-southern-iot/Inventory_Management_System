import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Role, type CreateDelegationInput, type Delegation } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, NotFoundError } from '../../common/errors';

/**
 * An approver handing their authority to someone else for a date range (task 3.5).
 *
 * Effectiveness is evaluated against `now` on every check rather than being cached or flagged:
 * a delegation that has expired must stop granting access the moment it expires, not at the
 * next time somebody remembers to run a job.
 */
@Injectable()
export class DelegationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(approverUserId?: string): Promise<Delegation[]> {
    const rows = await this.db
      .selectFrom('delegations')
      .innerJoin('users as approver', 'approver.id', 'delegations.approver_user_id')
      .innerJoin('users as delegate', 'delegate.id', 'delegations.delegate_user_id')
      .$if(approverUserId !== undefined, (qb) =>
        qb.where('delegations.approver_user_id', '=', approverUserId!),
      )
      .select([
        'delegations.id',
        'delegations.approver_user_id',
        'approver.full_name as approver_name',
        'delegations.delegate_user_id',
        'delegate.full_name as delegate_name',
        'delegations.starts_at',
        'delegations.ends_at',
        'delegations.is_active',
      ])
      .orderBy('delegations.starts_at', 'desc')
      .execute();

    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      approverUserId: row.approver_user_id,
      approverName: row.approver_name,
      delegateUserId: row.delegate_user_id,
      delegateName: row.delegate_name,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      isActive: row.is_active,
      isCurrentlyEffective:
        row.is_active && row.starts_at.getTime() <= now && row.ends_at.getTime() > now,
    }));
  }

  async create(input: CreateDelegationInput, approverUserId: string): Promise<Delegation> {
    if (input.delegateUserId === approverUserId) {
      throw new ConflictError('You cannot delegate to yourself');
    }

    // Delegating to someone with no approval rights would create a queue item nobody can act
    // on — the request would simply stall with no visible cause.
    const delegate = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .where('users.id', '=', input.delegateUserId)
      .where('users.is_active', '=', true)
      .where('user_roles.role', '=', Role.APPROVER)
      .select('users.id')
      .executeTakeFirst();
    if (!delegate) throw new ConflictError('The delegate must be an active approver');

    const row = await this.db
      .insertInto('delegations')
      .values({
        approver_user_id: approverUserId,
        delegate_user_id: input.delegateUserId,
        starts_at: new Date(input.startsAt),
        ends_at: new Date(input.endsAt),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const created = (await this.list(approverUserId)).find((d) => d.id === row.id);
    if (!created) throw new NotFoundError('Delegation');
    return created;
  }

  async revoke(id: string, approverUserId: string): Promise<void> {
    const result = await this.db
      .updateTable('delegations')
      .set({ is_active: false })
      .where('id', '=', id)
      .where('approver_user_id', '=', approverUserId)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows ?? 0n) === 0) throw new NotFoundError('Delegation');
  }

  /**
   * The authorisation check. Evaluated in SQL against `now()` so there is no window in which an
   * expired delegation still works because a cached value has not been refreshed.
   */
  async isEffectiveDelegate(approverUserId: string, candidateId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('delegations')
      .select('id')
      .where('approver_user_id', '=', approverUserId)
      .where('delegate_user_id', '=', candidateId)
      .where('is_active', '=', true)
      .where('starts_at', '<=', sql<Date>`now()`)
      .where('ends_at', '>', sql<Date>`now()`)
      .executeTakeFirst();

    return row !== undefined;
  }
}
