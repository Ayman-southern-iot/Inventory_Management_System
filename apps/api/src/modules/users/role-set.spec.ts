import { describe, expect, it } from 'vitest';
import { Role, roleSetSchema } from '@ims/shared';

/**
 * Roles are additive and GENERAL is implicit for everyone (plan 0.5). The normalisation lives in
 * the shared contract so the admin UI and the API cannot disagree about what a role set is;
 * this spec pins the three properties every caller relies on.
 */
describe('roleSetSchema', () => {
  it('adds GENERAL to a set that omits it', () => {
    expect(roleSetSchema.parse([Role.APPROVER])).toEqual([Role.APPROVER, Role.GENERAL]);
  });

  it('leaves an empty set as GENERAL rather than a user who can do nothing', () => {
    expect(roleSetSchema.parse([])).toEqual([Role.GENERAL]);
  });

  it('keeps every granted role — they are additive, not exclusive', () => {
    expect(roleSetSchema.parse([Role.ADMIN, Role.INVENTORY_MANAGER])).toEqual([
      Role.ADMIN,
      Role.GENERAL,
      Role.INVENTORY_MANAGER,
    ]);
  });

  it('dedupes a repeated role so user_roles cannot get a duplicate insert', () => {
    expect(roleSetSchema.parse([Role.APPROVER, Role.APPROVER, Role.GENERAL])).toEqual([
      Role.APPROVER,
      Role.GENERAL,
    ]);
  });

  it('produces a stable order regardless of input order', () => {
    const one = roleSetSchema.parse([Role.INVENTORY_MANAGER, Role.APPROVER]);
    const other = roleSetSchema.parse([Role.APPROVER, Role.INVENTORY_MANAGER]);
    expect(one).toEqual(other);
  });

  it('rejects a role that is not in the enum instead of storing it', () => {
    const result = roleSetSchema.safeParse(['SUPERUSER']);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown role even when valid roles are present', () => {
    const result = roleSetSchema.safeParse([Role.APPROVER, 'SUPERUSER']);
    expect(result.success).toBe(false);
  });
});
