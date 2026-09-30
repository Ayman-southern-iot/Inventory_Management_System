import { expect } from 'vitest';
import type { ApiKeyScope, Role } from '@ims/shared';
import type { Db } from '../src/database/create-db';
import type { HttpClient } from './app';
import { createUser, type CreatedUser } from './factories';

/**
 * ADR-0002 test helpers: service accounts and the keys bound to them.
 *
 * Created through the admin API wherever that is the path under test, so a spec exercises the
 * same validation an administrator meets. `serviceAccountWithKnownPassword` is the one exception,
 * and says why.
 */

export interface BoundKey {
  serviceAccountId: string;
  keyId: string;
  token: string;
}

/** A service account, made the way an administrator makes one. */
export async function createServiceAccount(admin: HttpClient, name?: string): Promise<string> {
  const response = await admin
    .post('/admin/api-keys/service-accounts')
    .send({ name: name ?? `Panel ${Math.random().toString(36).slice(2, 10)}` });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.id as string;
}

/**
 * A key bound to a service account, with the scopes asked for. Makes the account too unless one
 * is passed. Write keys must expire, so a lifetime is always sent.
 */
export async function issueBoundKey(
  admin: HttpClient,
  scopes: ApiKeyScope[],
  options: { serviceAccountId?: string; name?: string; expiresInDays?: number } = {},
): Promise<BoundKey> {
  const serviceAccountId = options.serviceAccountId ?? (await createServiceAccount(admin));
  const response = await admin.post('/admin/api-keys').send({
    name: options.name ?? 'Bound test key',
    scopes,
    expiresInDays: options.expiresInDays ?? 30,
    serviceAccountId,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return {
    serviceAccountId,
    keyId: response.body.key.id as string,
    token: response.body.token as string,
  };
}

/**
 * A service account whose password is the shared test password.
 *
 * Built by hand, not through the API, for exactly one reason: the sign-in refusal has to be
 * proven against a *correct* password. A real service account's password is random bytes nobody
 * kept, so "login failed" would prove nothing about why.
 */
export async function serviceAccountWithKnownPassword(
  db: Db,
  roles: readonly Role[],
  fullName = 'Known-password service account',
): Promise<CreatedUser> {
  const user = await createUser(db, { roles, fullName });
  await db
    .updateTable('users')
    .set({ is_service_account: true })
    .where('id', '=', user.id)
    .execute();
  return user;
}
