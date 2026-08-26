import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { titleForPath } from './useDocumentTitle';

/**
 * D-012. Every page reported the same tab title, so four open IMS tabs were indistinguishable
 * and browser history was a wall of identical entries.
 */
describe('titleForPath', () => {
  it('gives each top-level screen its own title', () => {
    const titles = [
      ROUTES.dashboard,
      ROUTES.requisitions.mine,
      ROUTES.boms.all,
      ROUTES.admin.auditLog,
      ROUTES.inventory.products,
    ].map(titleForPath);

    expect(new Set(titles).size).toBe(titles.length);
  });

  /**
   * The ordering trap: `/boms/new` also matches `/boms/:bomId`, so a title map that tested the
   * detail pattern first would title the generate screen "Bills of Materials".
   */
  it('prefers the more specific route over a pattern that would swallow it', () => {
    expect(titleForPath(ROUTES.boms.new)).toBe(t.boms.newBom);
    expect(titleForPath(ROUTES.boms.detail('abc'))).toBe(t.boms.title);
    expect(titleForPath(ROUTES.requisitions.new)).toBe(t.requisitions.newRequisition);
    expect(titleForPath(ROUTES.requisitions.detail('abc'))).toBe(t.requisitions.title);
  });

  it('titles a detail route from its pattern', () => {
    expect(titleForPath(ROUTES.projects.detail('p1'))).toBe(t.projects.title);
    expect(titleForPath(ROUTES.inventory.product('prod1'))).toBe(t.inventory.title);
  });

  it('falls back to the not-found title rather than an empty tab', () => {
    expect(titleForPath('/no/such/page')).toBe(t.states.notFoundTitle);
  });
});
