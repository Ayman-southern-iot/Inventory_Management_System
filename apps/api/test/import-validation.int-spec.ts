import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ImportIssueCode, Role, isImportWarning } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';
import {
  createCategory,
  createProduct,
  createStockFixture,
  type StockFixture,
} from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';
import { ImportValidationService } from '../src/modules/imports/import-validation.service';
import { CONFIG, type AppConfig } from '../src/config';
import { ProductsService } from '../src/modules/products/products.service';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { LocationsService } from '../src/modules/locations/locations.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { ProductExportService } from '../src/modules/imports/product-export.service';
import { IMPORT_COLUMNS, stripBom } from '../src/modules/imports/import-format';
import { lookupKey } from '../src/modules/imports/import-lookups';

/**
 * Validation against the real catalogue (`importing_data.md` part D).
 *
 * The unit tests in `import-validator.spec.ts` cover the rules against a fixture world. What can
 * only be proved here is that the rules and the **exporter** agree: the file this system writes
 * has to validate clean and plan nothing, or the round trip the whole feature rests on is a lie.
 * Everything below is that test, or a single edit away from it.
 */
describe('import validation', () => {
  let ctx: TestApp;
  let fixture: StockFixture;
  let actorId: string;
  let exporter: ProductExportService;
  let validator: ImportValidationService;

  /** The exported file, split for editing. Line 1 is the fingerprint, line 2 the headings. */
  async function exported(): Promise<string[]> {
    const csv = await exporter.toCsv();
    return stripBom(csv)
      .split('\r\n')
      .filter((line) => line.length > 0);
  }

  function edit(lines: string[], productId: string, column: string, value: string): string[] {
    const index = IMPORT_COLUMNS.indexOf(column as never);
    return lines.map((line, position) => {
      if (position < 2 || !line.includes(productId)) return line;
      const cells = line.split(',');
      cells[index] = value;
      return cells.join(',');
    });
  }

  const file = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

  /** One row for a product that does not exist yet, at no location and no quantity. */
  function newProductRow(name: string, categoryPath = ''): string {
    return IMPORT_COLUMNS.map((column) => {
      if (column === 'product_name') return name;
      if (column === 'unit') return 'pcs';
      if (column === 'default_returnable') return 'yes';
      if (column === 'status') return 'Active';
      if (column === 'category_path') return categoryPath;
      if (column === 'on_hand') return '0';
      return '';
    }).join(',');
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    exporter = ctx.app.get(ProductExportService);
    validator = ctx.app.get(ImportValidationService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
    });
    actorId = session.user.id;

    await ctx.app
      .get(StockService)
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        { performedBy: actorId, note: 'validation fixture' },
      );
  });

  describe('the round trip', () => {
    /**
     * The one that matters. Export, import the same bytes back, and the answer has to be "this
     * changes nothing" — no errors, no warnings, no creates, no deactivations, every shelf
     * already where the file says it is (C46).
     */
    it('plans nothing at all for an unedited export', async () => {
      const outcome = await validator.validate(file(await exported()));

      expect(outcome.errors).toEqual([]);
      expect(outcome.warnings).toEqual([]);
      expect(outcome.plan).not.toBeNull();
      expect(outcome.plan!.categoriesToCreate).toEqual([]);
      expect(outcome.plan!.deactivations).toEqual([]);

      for (const product of outcome.plan!.products) {
        expect(product.productId).not.toBeNull();
        for (const shelf of product.shelves) {
          expect(shelf.targetOnHand).toBe(shelf.currentOnHand);
        }
      }
    });

    it('survives a product whose name would break a naive CSV reader', async () => {
      await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: 'Cable, 2m "premium"',
      });

      const outcome = await validator.validate(file(await exported()));
      expect(outcome.errors).toEqual([]);
      expect(outcome.plan!.products.some((p) => p.name === 'Cable, 2m "premium"')).toBe(true);
    });

    it('reads back a file that still carries the byte-order mark Excel wants', async () => {
      const outcome = await validator.validate(await exporter.toCsv());
      expect(outcome.errors).toEqual([]);
    });
  });

  describe('an edited export', () => {
    it('plans the quantity change and nothing else', async () => {
      const outcome = await validator.validate(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      expect(outcome.errors).toEqual([]);
      const planned = outcome.plan!.products.find((p) => p.productId === fixture.productId)!;
      expect(planned.shelves).toEqual([
        expect.objectContaining({
          compartmentId: fixture.compartmentA,
          currentOnHand: 10,
          targetOnHand: 4,
        }),
      ]);
    });

    it('plans a new product and the categories its path asks for', async () => {
      const lines = await exported();
      const blank = IMPORT_COLUMNS.map((column) => {
        switch (column) {
          case 'product_name':
            return 'Hokuyo UST-10LX';
          case 'unit':
            return 'pcs';
          case 'default_returnable':
            return 'yes';
          case 'status':
            return 'Active';
          case 'category_path':
            return 'Sensors / Lidar';
          case 'on_hand':
            // No location on this row, so no stock either — I3 allows exactly this shape, and
            // the Claude skill relies on it: it may invent a category, never a shelf.
            return '0';
          default:
            return '';
        }
      }).join(',');

      const outcome = await validator.validate(file([...lines, blank]));

      expect(outcome.errors).toEqual([]);
      expect(outcome.plan!.categoriesToCreate.map((c) => c.path.join(' / '))).toEqual([
        'Sensors',
        'Sensors / Lidar',
      ]);
      const created = outcome.plan!.products.find((p) => p.name === 'Hokuyo UST-10LX')!;
      expect(created.productId).toBeNull();
      expect(created.newCategoryIndex).toBe(1);
      // No shelf: the row has a quantity but no location, so nothing was resolved for it.
      expect(created.shelves).toEqual([]);
    });

    it('retires a product whose rows are deleted from the file', async () => {
      const doomed = await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: `Doomed ${randomUUID().slice(0, 8)}`,
      });

      const lines = (await exported()).filter((line) => !line.includes(doomed));
      const outcome = await validator.validate(file(lines));

      expect(outcome.errors).toEqual([]);
      expect(outcome.plan!.deactivations.map((d) => d.productId)).toEqual([doomed]);
    });

    it('refuses a count below what the shelf has reserved', async () => {
      // Reserve two of the ten, then try to count the shelf down to one.
      await ctx.db
        .updateTable('stock_placements')
        .set({ reserved_qty: 2 })
        .where('product_id', '=', fixture.productId)
        .where('compartment_id', '=', fixture.compartmentA)
        .execute();

      const outcome = await validator.validate(
        file(edit(await exported(), fixture.productId, 'on_hand', '1')),
      );

      expect(outcome.plan).toBeNull();
      expect(outcome.errors[0]!.code).toBe(ImportIssueCode.BELOW_RESERVED);
    });
  });

  describe('what the lookups know that the file cannot', () => {
    it('refuses to file a product into a retired category', async () => {
      const retired = await createCategory(ctx.db, { name: `Retired ${randomUUID().slice(0, 8)}` });
      await ctx.db
        .updateTable('categories')
        .set({ is_active: false })
        .where('id', '=', retired)
        .execute();

      // The path goes with it: an id and a path naming two different categories is its own
      // error (C11), and it would fire before this one.
      const lines = edit(await exported(), fixture.productId, 'category_id', retired);
      const outcome = await validator.validate(
        file(edit(lines, fixture.productId, 'category_path', '')),
      );

      expect(outcome.errors.map((i) => i.code)).toContain(ImportIssueCode.CATEGORY_RETIRED);
    });

    it('refuses a retired shelf', async () => {
      await ctx.db
        .updateTable('storage_compartments')
        .set({ is_active: false })
        .where('id', '=', fixture.compartmentB)
        .execute();

      const shelf = await ctx.db
        .selectFrom('storage_compartments')
        .select(['storage_id', 'code'])
        .where('id', '=', fixture.compartmentB)
        .executeTakeFirstOrThrow();

      const lines = edit(
        await exported(),
        fixture.productId,
        'storage_id',
        `"${shelf.storage_id}"`,
      );
      const outcome = await validator.validate(
        file(edit(lines, fixture.productId, 'compartment', shelf.code)),
      );

      expect(outcome.errors[0]!.code).toBe(ImportIssueCode.SHELF_RETIRED);
      // The wording is the behaviour here: which of the three levels is retired decides where
      // the person has to go to fix it.
      expect(outcome.errors[0]!.message).toMatch(/its compartment is not active/);
    });
  });

  describe('the fingerprint', () => {
    it('refuses a file exported from a different installation', async () => {
      const lines = await exported();
      lines[0] = lines[0]!.replace(/origin \S+/, `origin ${randomUUID()}`);

      const outcome = await validator.validate(file(lines));
      expect(outcome.errors[0]!.code).toBe(ImportIssueCode.FILE_FOREIGN_DEPLOYMENT);
    });

    /** A snapshot is this deployment's own file by construction, even after a machine move. */
    it('accepts a foreign origin when restoring', async () => {
      const lines = await exported();
      lines[0] = lines[0]!.replace(/origin \S+/, `origin ${randomUUID()}`);

      const outcome = await validator.validate(file(lines), { isRestore: true });
      expect(outcome.errors).toEqual([]);
    });
  });

  describe('the diff the confirm screen shows', () => {
    /**
     * The same property as the unit test, but against a file this system actually wrote. If the
     * exporter and the diff ever disagree about what "no change" looks like, every import after
     * that reads as a large edit and the confirm step stops meaning anything.
     */
    it('is all zeroes for an unedited export', async () => {
      const outcome = await validator.validate(file(await exported()));

      expect(outcome.diff).toEqual({
        productsCreated: 0,
        productsUpdated: 0,
        productsDeactivated: 0,
        productsRenamed: 0,
        productsRecategorised: 0,
        categoriesCreated: [],
        shelvesChanged: 0,
        unitsAdded: 0,
        unitsRemoved: 0,
        warnings: [],
      });
    });

    it('counts one changed shelf and the units on it', async () => {
      const outcome = await validator.validate(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      expect(outcome.diff).toMatchObject({
        productsUpdated: 1,
        productsCreated: 0,
        shelvesChanged: 1,
        unitsAdded: 0,
        unitsRemoved: 6,
      });
    });

    it('carries every warning the run produced, the late ones included', async () => {
      await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: 'Lenovo ThinkPad T14 Gen 3',
      });

      const outcome = await validator.validate(
        file([...(await exported()), newProductRow('Lenovo ThinkPad T14 Gen 4')]),
      );

      // The near-duplicate pass runs after the validator, so this is also the check that the
      // diff is built last rather than from a snapshot of the warnings taken too early.
      expect(outcome.diff!.warnings.map((i) => i.code)).toContain(
        ImportIssueCode.NAME_NEAR_DUPLICATE,
      );
      expect(outcome.diff!.warnings).toEqual(outcome.warnings);
    });

    it('has no diff to show when the file is refused', async () => {
      const outcome = await validator.validate(
        file(edit(await exported(), fixture.productId, 'on_hand', '-1')),
      );

      expect(outcome.errors).not.toEqual([]);
      expect(outcome.diff).toBeNull();
    });
  });

  describe('the changed-shelf ceiling (OQ-IMP-1)', () => {
    /**
     * A tiny ceiling, so the test does not have to build ten thousand shelves. What is being
     * tested is which quantity the cap measures, not the number it is set to.
     */
    function withCeiling(maxChangedShelves: number) {
      const real = ctx.app.get<AppConfig>(CONFIG);
      return new ImportValidationService(
        ctx.app.get(ProductsService),
        ctx.app.get(CategoriesService),
        ctx.app.get(LocationsService),
        ctx.app.get(StockService),
        ctx.app.get(SettingsService),
        { ...real, imports: { ...real.imports, maxChangedShelves } } as AppConfig,
      );
    }

    it('refuses a file that would change more shelves than one apply may', async () => {
      const tight = withCeiling(0);
      const outcome = await tight.validate(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
      );

      expect(outcome.plan).toBeNull();
      expect(outcome.diff).toBeNull();
      expect(outcome.errors[0]!.code).toBe(ImportIssueCode.TOO_MANY_CHANGED_SHELVES);
      expect(outcome.errors[0]!.message).toMatch(/would change the count on 1 shelves/);
    });

    /**
     * The whole point of measuring the diff rather than the rows: re-importing an unedited
     * export changes nothing, so no ceiling can refuse it however low it is set.
     */
    it('lets a file that changes nothing through a ceiling of zero', async () => {
      const outcome = await withCeiling(0).validate(file(await exported()));

      expect(outcome.errors).toEqual([]);
      expect(outcome.diff!.shelvesChanged).toBe(0);
    });

    /**
     * A restore skips the parse-phase caps, because a snapshot is this system's own file rather
     * than arbitrary input. It does not skip this one: forty thousand shelves cost the same to
     * write whichever direction they came from.
     */
    it('applies to a restore as well, unlike the parse-phase caps', async () => {
      const outcome = await withCeiling(0).validate(
        file(edit(await exported(), fixture.productId, 'on_hand', '4')),
        { isRestore: true },
      );

      expect(outcome.errors[0]!.code).toBe(ImportIssueCode.TOO_MANY_CHANGED_SHELVES);
    });

    it('is an error, never advice', () => {
      expect(isImportWarning(ImportIssueCode.TOO_MANY_CHANGED_SHELVES)).toBe(false);
    });
  });

  describe('near-duplicate names', () => {
    it('warns that a new product looks like one already in the catalogue', async () => {
      await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: 'Lenovo ThinkPad T14 Gen 3',
      });

      const outcome = await validator.validate(
        file([...(await exported()), newProductRow('Lenovo ThinkPad T14 Gen 4')]),
      );

      expect(outcome.errors).toEqual([]);
      const warning = outcome.warnings.find((i) => i.code === ImportIssueCode.NAME_NEAR_DUPLICATE);
      expect(warning).toBeDefined();
      expect(warning!.message).toMatch(/Lenovo ThinkPad T14 Gen 3/);
    });

    /** The whole point of a threshold: an unrelated name must not produce advice. */
    it('says nothing about a name that resembles nothing', async () => {
      const outcome = await validator.validate(
        file([...(await exported()), newProductRow('Hokuyo UST-10LX')]),
      );

      expect(outcome.warnings.map((i) => i.code)).not.toContain(
        ImportIssueCode.NAME_NEAR_DUPLICATE,
      );
    });

    it('warns that a new category looks like an existing one', async () => {
      // Randomised: `resetData` keeps categories, and `categories_root_name_key` is global,
      // so a fixed name collides with the next test in this same file.
      const stem = `Power Tools ${randomUUID().slice(0, 8)}`;
      await createCategory(ctx.db, { name: stem });

      const outcome = await validator.validate(
        file([...(await exported()), newProductRow('Some New Thing', `${stem} Set`)]),
      );

      expect(outcome.errors).toEqual([]);
      expect(outcome.warnings.map((i) => i.code)).toContain(
        ImportIssueCode.CATEGORY_NEAR_DUPLICATE,
      );
    });

    /** It never blocks: §2.4. A near match is advice, and the human decides. */
    it('never turns a near duplicate into an error', async () => {
      await createProduct(ctx.db, { categoryId: fixture.categoryId, name: 'Widget Mark II' });

      const outcome = await validator.validate(
        file([...(await exported()), newProductRow('Widget Mark III')]),
      );

      expect(outcome.errors).toEqual([]);
      expect(outcome.plan).not.toBeNull();
    });

    /**
     * Every issue this service produces, on the right side of the severity partition — the same
     * check the validator spec makes, extended to the three codes only reachable with a
     * database. Without it those three would be the enum's blind spot.
     */
    it('puts each of its own warnings on the warning side of the partition', async () => {
      await createProduct(ctx.db, { categoryId: fixture.categoryId, name: 'Widget Mark II' });
      const stem = `Hand Tools ${randomUUID().slice(0, 8)}`;
      await createCategory(ctx.db, { name: stem });

      const outcome = await validator.validate(
        file([...(await exported()), newProductRow('Widget Mark III', `${stem} Set`)]),
      );

      for (const warning of outcome.warnings) {
        expect({ code: warning.code, warning: isImportWarning(warning.code) }).toEqual({
          code: warning.code,
          warning: true,
        });
      }
      for (const error of outcome.errors) {
        expect({ code: error.code, warning: isImportWarning(error.code) }).toEqual({
          code: error.code,
          warning: false,
        });
      }
      expect(outcome.warnings.map((i) => i.code)).toEqual(
        expect.arrayContaining([
          ImportIssueCode.NAME_NEAR_DUPLICATE,
          ImportIssueCode.CATEGORY_NEAR_DUPLICATE,
        ]),
      );
    });
  });

  describe('the bulk-loaded maps', () => {
    /** Four queries whatever the file's size — the whole reason validation is not N+1 (§11.1). */
    it('carries every product, category, shelf and placement, retired ones included', async () => {
      const hidden = await createProduct(ctx.db, {
        categoryId: fixture.categoryId,
        name: `Hidden ${randomUUID().slice(0, 8)}`,
        isActive: false,
      });

      const lookups = await validator.loadLookups();

      expect(lookups.productById.has(hidden)).toBe(true);
      expect(lookups.productById.has(fixture.productId)).toBe(true);
      expect(lookups.categoryById.has(fixture.categoryId)).toBe(true);
      expect(lookups.compartmentById.has(fixture.compartmentA)).toBe(true);
      expect(lookups.compartmentById.has(fixture.compartmentB)).toBe(true);
      expect(lookups.placementsByProduct.get(fixture.productId)).toHaveLength(1);
    });

    /**
     * Keyed exactly as `products_code_key` is, on `lower(btrim(...))`. A map keyed any other way
     * would disagree with the unique index — matching rows Postgres thinks are distinct, or
     * creating a duplicate the index then rejects halfway through the apply transaction.
     */
    it('keys a product code the way the database does', async () => {
      const lookups = await validator.loadLookups();
      const code = lookups.productById.get(fixture.productId)!.productCode;

      expect(lookups.productByCode.get(lookupKey(` ${code.toUpperCase()} `))?.id).toBe(
        fixture.productId,
      );
    });
  });
});
