import { Role } from '@ims/shared';

/*
 * Service accounts (ADR-0002) — the principals write-capable API keys act as.
 *
 * These are part of the model rather than policy: nothing about them should vary by deployment,
 * which is why they are named constants here and not config (rules/10-no-hardcoding.md).
 */

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a service account's address can
 * never collide with, or be mistaken for, a real mailbox — and `users.email` stays NOT NULL and
 * unique without inventing a convention somebody could one day register.
 */
export const SERVICE_ACCOUNT_EMAIL_DOMAIN = 'service.invalid';

/** `users.designation` is NOT NULL. Never shown: service accounts appear in no picker or PDF. */
export const SERVICE_ACCOUNT_DESIGNATION = 'Service account';

/**
 * Every write a key can reach is an Inventory Manager action, so the account holds IM; what a
 * given key may actually do is narrowed by that key's scopes. Never APPROVER or ADMIN — the
 * user-admin paths refuse service accounts, so nothing can add either later.
 */
export const SERVICE_ACCOUNT_ROLES: readonly Role[] = [Role.GENERAL, Role.INVENTORY_MANAGER];

/**
 * A service account has no password anybody knows. It gets the hash of 32 random bytes that are
 * thrown away, so even if the sign-in refusal were bypassed there is nothing to type.
 */
export const SERVICE_ACCOUNT_UNUSABLE_SECRET_BYTES = 32;
