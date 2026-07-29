import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module';
import type { Db } from '../database/create-db';
import { isUniqueViolation } from './pg-errors';

/**
 * Makes a mutating endpoint safe to repeat (rules/20-backend.md, closes gap G-04).
 *
 * The unique index on (user_id, scope, key) is what makes this atomic: two concurrent requests
 * carrying the same key both try to INSERT, exactly one wins, and the loser is told to read the
 * winner's answer. A check-then-act version would let a double-click issue stock twice, which
 * on this system is unrecoverable — the shelf and the ledger diverge.
 *
 * Keys are scoped per endpoint so reusing a key on a different action is not silently replayed.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Runs `operation` at most once for a given (user, scope, key).
   *
   * A repeat returns the stored response. A repeat that arrives while the first is still in
   * flight — the double-click case — finds a claimed row with no response yet and is told to
   * retry rather than being handed a half-truth.
   */
  async run<T>(
    params: { key: string | undefined; userId: string; scope: string },
    operation: () => Promise<T>,
  ): Promise<{ result: T; replayed: boolean } | { inFlight: true }> {
    if (!params.key) return { result: await operation(), replayed: false };

    let claimed = false;
    try {
      await this.db
        .insertInto('idempotency_keys')
        .values({ key: params.key, user_id: params.userId, scope: params.scope })
        .execute();
      claimed = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    if (!claimed) {
      const existing = await this.db
        .selectFrom('idempotency_keys')
        .select('response')
        .where('key', '=', params.key)
        .where('user_id', '=', params.userId)
        .where('scope', '=', params.scope)
        .executeTakeFirst();

      if (existing?.response == null) return { inFlight: true };
      return { result: existing.response as T, replayed: true };
    }

    try {
      const result = await operation();
      await this.db
        .updateTable('idempotency_keys')
        .set({ response: JSON.stringify(result) })
        .where('key', '=', params.key)
        .where('user_id', '=', params.userId)
        .where('scope', '=', params.scope)
        .execute();
      return { result, replayed: false };
    } catch (error) {
      // A failed operation must not leave a claim behind, or the caller could never retry.
      await this.db
        .deleteFrom('idempotency_keys')
        .where('key', '=', params.key)
        .where('user_id', '=', params.userId)
        .where('scope', '=', params.scope)
        .execute();
      throw error;
    }
  }

  /** Called by the retention job; a key has no value once nobody could still be retrying. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('idempotency_keys')
      .where('created_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
