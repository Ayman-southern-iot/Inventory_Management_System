import { sql, type Kysely } from 'kysely';

/**
 * Category becomes optional, and the tree gets the two guards it has always needed.
 *
 * Per `category-taxonomy-spec.md` (Ayman, 2026-09-20), which is authoritative for this part.
 *
 * ---------------------------------------------------------------------------------------------
 * **1. `products.category_id` becomes nullable** (spec §1, plan D4).
 *
 * "A product must NEVER be blocked from being added because a perfect category doesn't exist
 * yet." Blocking the save is what produces junk categories — somebody picks the nearest wrong
 * node to get past the form, and the tree is poisoned by the thing that was meant to protect it.
 * `NULL` is a first-class, supported state with its own filter on the inventory screen.
 *
 * The dangerous half of this change is not the column. It is that three queries INNER JOIN
 * `categories`, so the moment a product has no category it disappears from the product list, the
 * borrow lookup and the stock guard with no error anywhere. Those are fixed in the same change
 * as this migration; a nullable FK plus an existing inner join is how rows vanish silently.
 *
 * ---------------------------------------------------------------------------------------------
 * **2. Max depth 3, enforced by trigger** (spec §4).
 *
 * `Top-Level → Subcategory → Type`. The spec is explicit that a `CHECK` cannot do this and it is
 * right: Postgres `CHECK` constraints cannot reference other rows, and depth means walking up
 * `parent_id`. So a `BEFORE INSERT OR UPDATE` trigger runs a recursive CTE up the ancestor chain.
 *
 * This is the same tool the schema already uses for append-only tables, pointed at a different
 * invariant. The UI-side check is a convenience; this is the guarantee, and a direct API call
 * goes through it identically.
 *
 * ---------------------------------------------------------------------------------------------
 * **3. No cycles.**
 *
 * `updateCategorySchema` has always omitted `parentId` with the comment "re-parenting needs
 * cycle handling" — that comment is the specification for this trigger. Re-parenting a node
 * under its own descendant would create a ring that the depth walk above would follow forever,
 * so the cycle check has to come first and has to be in the database.
 *
 * `categories_not_own_parent` (migration 0006) already covers the one-node case. This covers
 * every longer ring.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ------------------------------------------------- category is optional
  await sql`ALTER TABLE products ALTER COLUMN category_id DROP NOT NULL`.execute(db);

  // ----------------------------------------------------- depth and cycles
  /**
   * One trigger for both invariants, because they are checked on the same events and the cycle
   * check must run first: a ring makes the depth walk non-terminating, so ordering them as two
   * independent triggers would leave the outcome depending on trigger name alphabetisation.
   *
   * The recursive CTE is bounded by `depth <= 4` rather than run to exhaustion — it only ever
   * needs to know whether a fourth ancestor exists, and bounding it means a ring that somehow
   * slipped past the cycle check still cannot hang the transaction.
   */
  await sql`
    CREATE OR REPLACE FUNCTION categories_enforce_tree_shape() RETURNS trigger AS $$
    DECLARE
      ancestor_depth integer;
      would_cycle boolean;
    BEGIN
      IF NEW.parent_id IS NULL THEN
        RETURN NEW;
      END IF;

      -- Cycle first. On an UPDATE, moving a node under one of its own descendants is the only
      -- way to make a ring, and it is exactly what a "move a node" UI makes easy to do.
      IF TG_OP = 'UPDATE' THEN
        WITH RECURSIVE descendants AS (
          SELECT id FROM categories WHERE id = NEW.id
          UNION ALL
          SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
        )
        SELECT EXISTS (SELECT 1 FROM descendants WHERE id = NEW.parent_id) INTO would_cycle;

        IF would_cycle THEN
          RAISE EXCEPTION
            'A category cannot be moved underneath itself or one of its own subcategories.'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      -- Then depth. NEW is one level below its parent, so the parent may have at most one
      -- ancestor of its own for NEW to land at level 3.
      WITH RECURSIVE chain AS (
        SELECT parent_id, 1 AS depth FROM categories WHERE id = NEW.parent_id
        UNION ALL
        SELECT c.parent_id, chain.depth + 1
        FROM categories c JOIN chain ON c.id = chain.parent_id
        WHERE chain.depth <= 4
      )
      SELECT max(depth) INTO ancestor_depth FROM chain;

      IF ancestor_depth >= 3 THEN
        RAISE EXCEPTION
          'Categories go three levels deep at most (category > subcategory > type).'
          USING ERRCODE = 'check_violation';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER categories_tree_shape
    BEFORE INSERT OR UPDATE OF parent_id ON categories
    FOR EACH ROW EXECUTE FUNCTION categories_enforce_tree_shape()
  `.execute(db);

  // Every "the children of X" lookup, and the recursive walks above.
  await sql`CREATE INDEX categories_parent_idx ON categories (parent_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS categories_tree_shape ON categories`.execute(db);
  await sql`DROP FUNCTION IF EXISTS categories_enforce_tree_shape()`.execute(db);
  await sql`DROP INDEX IF EXISTS categories_parent_idx`.execute(db);

  /**
   * Restoring NOT NULL fails if any product has been left uncategorised — which is the whole
   * point of the feature, so it is the expected outcome rather than a surprise. Fail with the
   * count and the instruction instead of a bare constraint error naming one row.
   */
  const orphans = await sql<{ n: string }>`
    SELECT count(*) AS n FROM products WHERE category_id IS NULL
  `.execute(db);

  const count = Number(orphans.rows[0]?.n ?? 0);
  if (count > 0) {
    throw new Error(
      `Cannot roll back 0035: ${count} product(s) have no category, and the column was NOT NULL ` +
        'before this migration. Assign them a category first.',
    );
  }

  await sql`ALTER TABLE products ALTER COLUMN category_id SET NOT NULL`.execute(db);
}
