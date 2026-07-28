import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, type ExpressionBuilder } from 'kysely';
import type { Role } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';
import { RefreshRevocationReason, type RefreshTokenRow } from '../../database/schema';

/** Aggregated in the same query rather than a second round trip. */
function jsonRoles(_eb: ExpressionBuilder<Database, 'users'>) {
  return sql<Role[]>`
    coalesce(
      (select array_agg(ur.role::text order by ur.role) from user_roles ur where ur.user_id = users.id),
      ARRAY[]::text[]
    )
  `;
}

export interface SessionState {
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: Role[];
  /** False once the family has been revoked — logout, admin action, or reuse detection. */
  hasLiveSession: boolean;
}

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

  /**
   * The live-session check behind every authenticated request.
   *
   * An access token is a 15-minute bearer credential, so without this a deactivated user keeps
   * full access — including admin access — until it expires. One indexed lookup per request is
   * a trade worth making at this system's scale, and it closes deactivation, logout, role
   * change and forced password rotation in a single query.
   */
  async findLiveSession(userId: string, familyId: string): Promise<SessionState | undefined> {
    const row = await this.db
      .selectFrom('users')
      .where('users.id', '=', userId)
      .select((eb) => [
        'users.email',
        'users.is_active',
        'users.must_change_password',
        jsonRoles(eb).as('roles'),
        // Selected rather than filtered on, so the caller can tell "this session was revoked"
        // apart from "this account is deactivated" and say the right thing about each.
        eb
          .exists(
            eb
              .selectFrom('refresh_tokens')
              .select('refresh_tokens.id')
              .whereRef('refresh_tokens.user_id', '=', 'users.id')
              .where('refresh_tokens.family_id', '=', familyId)
              .where('refresh_tokens.revoked_at', 'is', null),
          )
          .as('has_live_session'),
      ])
      .executeTakeFirst();

    if (!row) return undefined;
    return {
      email: row.email,
      isActive: row.is_active,
      mustChangePassword: row.must_change_password,
      roles: row.roles,
      hasLiveSession: Boolean(row.has_live_session),
    };
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
