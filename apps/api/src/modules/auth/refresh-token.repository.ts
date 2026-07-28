import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { RefreshRevocationReason, type RefreshTokenRow } from '../../database/schema';

/** Stored hashed, so a database dump does not hand out working sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class RefreshTokenRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  newFamilyId(): string {
    return randomUUID();
  }

  async issue(params: {
    userId: string;
    token: string;
    familyId: string;
    expiresAt: Date;
    userAgent: string | null;
    replacesId?: string;
  }): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const inserted = await tx
        .insertInto('refresh_tokens')
        .values({
          user_id: params.userId,
          token_hash: hashToken(params.token),
          family_id: params.familyId,
          expires_at: params.expiresAt,
          user_agent: params.userAgent,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (params.replacesId) {
        await tx
          .updateTable('refresh_tokens')
          .set({
            revoked_at: new Date(),
            revoked_reason: RefreshRevocationReason.ROTATED,
            replaced_by_id: inserted.id,
          })
          .where('id', '=', params.replacesId)
          .execute();
      }

      return inserted.id;
    });
  }

  async findByToken(token: string): Promise<RefreshTokenRow | undefined> {
    return this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();
  }

  /**
   * Reuse of an already-rotated token means the token leaked. Revoking the whole family logs
   * out both the attacker and the legitimate user, which is the correct trade — the alternative
   * is leaving the attacker with a valid session.
   */
  async revokeFamily(familyId: string, reason: RefreshRevocationReason): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('family_id', '=', familyId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeById(id: string, reason: RefreshRevocationReason): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAllForUser(userId: string, reason: RefreshRevocationReason): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Called by the nightly job; expired rows have no security value and only cost space. */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('refresh_tokens')
      .where('expires_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
