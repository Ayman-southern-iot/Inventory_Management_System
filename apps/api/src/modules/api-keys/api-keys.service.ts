import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  API_KEY_TOKEN_PREFIX,
  type ApiKey,
  type ApiKeyScope,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type ListApiKeysQuery,
  type Paginated,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import {
  ApiKeyDisabledError,
  ApiKeyInvalidError,
  ConflictError,
  NotFoundError,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { ApiKeysRepository, type ApiKeyRow } from './api-keys.repository';

/**
 * 32 bytes of randomness, base64url-encoded. Well past the point where guessing is the attack
 * anybody would choose, and short enough to paste into a config file without wrapping.
 */
const TOKEN_BYTES = 32;
/**
 * How much of the token is kept in the clear for the admin list. Enough to tell two keys apart
 * at a glance, far too little to narrow a search: the remaining ~35 characters are the secret.
 */
const DISPLAY_PREFIX_CHARS = 8;

const MS_PER_DAY = 86_400_000;

/** Same treatment `refresh_tokens` gives its tokens — a database dump yields nothing usable. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** What an authenticated key carries for the rest of the request. Note: no user, no roles. */
export interface AuthenticatedApiKey {
  id: string;
  scopes: readonly ApiKeyScope[];
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly repository: ApiKeysRepository,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The hot path. Called by the auth guard on every request presenting a key.
   *
   * The three rejections are distinct on purpose (OQ-G2): an unknown, revoked or expired key is
   * `API_KEY_INVALID`, because telling an anonymous caller "that one existed once" is a hint
   * they have not earned; a key that is real, current and merely switched off is
   * `API_KEY_DISABLED`, because the integrator's next step is to ask their admin rather than
   * hunt for a typo.
   */
  async authenticate(token: string): Promise<AuthenticatedApiKey> {
    const row = await this.repository.findByTokenHash(hashToken(token));
    if (!row) throw new ApiKeyInvalidError();
    if (row.revoked_at !== null) throw new ApiKeyInvalidError();
    if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
      throw new ApiKeyInvalidError();
    }
    if (!row.is_active) throw new ApiKeyDisabledError();

    /*
     * Fire-and-forget. A failure to record *when* a key was used must never turn a successful
     * read into a 500 — the read already succeeded by the time we get here, and the stamp is a
     * convenience for the admin list, not part of the answer.
     */
    void this.repository
      .touch(row.id, this.config.apiKeys.touchIntervalSeconds)
      .catch((error: unknown) => {
        this.logger.warn(`Could not stamp last_used_at for API key ${row.id}: ${String(error)}`);
      });

    return { id: row.id, scopes: row.scopes };
  }

  async list(query: ListApiKeysQuery): Promise<Paginated<ApiKey>> {
    const { rows, total } = await this.repository.list({
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
      includeRevoked: query.includeRevoked,
    });
    return { items: rows.map(toApiKey), page: query.page, limit: query.limit, total };
  }

  /**
   * Mint a key. The only moment the raw token exists outside the caller's hands — it is hashed
   * immediately and the plaintext is never stored, logged or returned again.
   */
  async create(input: CreateApiKeyInput, context: AuditContext): Promise<CreatedApiKey> {
    if (!context.actorId) throw new ConflictError('An API key must be created by a signed-in user');

    const token = `${API_KEY_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
    const keyPrefix = token.slice(0, API_KEY_TOKEN_PREFIX.length + DISPLAY_PREFIX_CHARS);

    const expiresAt =
      input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * MS_PER_DAY);

    const id = await this.repository.insert({
      name: input.name,
      keyPrefix,
      tokenHash: hashToken(token),
      scopes: input.scopes,
      expiresAt,
      createdBy: context.actorId,
    });

    await this.audit.record(
      {
        action: 'api_key.create',
        entityType: 'api_key',
        entityId: id,
        entityRef: keyPrefix,
        summary: `Issued API key "${input.name}"`,
        // The prefix, the scopes and the expiry. Never the token, and never its hash — an audit
        // row is read by more people than the table it describes.
        metadata: { keyPrefix, scopes: input.scopes, expiresAt: expiresAt?.toISOString() ?? null },
      },
      context,
    );

    const created = await this.repository.findById(id);
    if (!created) throw new NotFoundError('API key');
    return { key: toApiKey(created), token };
  }

  async setActive(id: string, isActive: boolean, context: AuditContext): Promise<ApiKey> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError('API key');
    if (existing.revoked_at !== null) {
      throw new ConflictError('This key has been revoked and cannot be re-enabled');
    }

    const changed = await this.repository.setActive(id, isActive);
    if (!changed) throw new ConflictError('This key has been revoked and cannot be re-enabled');

    await this.audit.record(
      {
        action: isActive ? 'api_key.enable' : 'api_key.disable',
        entityType: 'api_key',
        entityId: id,
        entityRef: existing.key_prefix,
        summary: `${isActive ? 'Enabled' : 'Disabled'} API key "${existing.name}"`,
        metadata: { keyPrefix: existing.key_prefix },
      },
      context,
    );

    const updated = await this.repository.findById(id);
    if (!updated) throw new NotFoundError('API key');
    return toApiKey(updated);
  }

  /** Permanent. The row survives so the audit trail still has something to point at. */
  async revoke(id: string, context: AuditContext): Promise<void> {
    if (!context.actorId) throw new ConflictError('An API key must be revoked by a signed-in user');

    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError('API key');
    if (existing.revoked_at !== null) return; // already gone; revoking twice is not an error

    await this.repository.revoke(id, context.actorId);

    await this.audit.record(
      {
        action: 'api_key.revoke',
        entityType: 'api_key',
        entityId: id,
        entityRef: existing.key_prefix,
        summary: `Revoked API key "${existing.name}"`,
        metadata: { keyPrefix: existing.key_prefix },
      },
      context,
    );
  }
}

/**
 * Row to contract. Written out rather than spread, so adding a column to the table can never
 * silently add it to an API response — `token_hash` is one field away from every one of these.
 */
function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    isActive: row.is_active,
    expiresAt: row.expires_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdById: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    // Derived rather than stored: expiry is a function of the clock, not a state somebody sets,
    // and a stored flag would be wrong for however long it took a job to notice.
    isExpired: row.expires_at !== null && row.expires_at.getTime() <= Date.now(),
  };
}
