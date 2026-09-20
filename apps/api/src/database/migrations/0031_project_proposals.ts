import { sql, type Kysely } from 'kysely';

/**
 * A project is proposed by anyone and made real by the Inventory Manager.
 *
 * Forced by the user review of 2026-09-20: "Only the Inventory Manager should be able to add
 * projects and inventory items. At the moment anyone can, and the lists keep piling up."
 *
 * Inventory items were already IM-only — `POST /products` carries
 * `@Roles(INVENTORY_MANAGER, ADMIN)` and so does every caller of `createWithin`. Projects were
 * genuinely open, and deliberately so: `projects.controller.ts` reads "The hub is everyone's:
 * no @Roles here, deliberately", because a project is created on the fly while raising the
 * borrow or requisition charged to it. Slamming that shut would push the cost onto the person
 * mid-form, who now has to stop and find an IM.
 *
 * So Ayman's ruling was propose-then-approve rather than a hard restriction: anyone may still
 * create one without leaving the form, but it does not reach the pickers until the IM accepts
 * it. The pile-up stops without taking the capability away.
 *
 * ---------------------------------------------------------------------------------------------
 * `is_active` is NOT reused for this. It already means "archived — do not offer this any more",
 * which is a different fact from "nobody has accepted this yet": an archived project was real
 * and has history charged to it, a proposed one may never become real at all. Collapsing the two
 * would make "why is this project missing from the list" unanswerable.
 *
 * ---------------------------------------------------------------------------------------------
 * Existing rows become ACTIVE, not PROPOSED. They are in use, with borrows and requisitions
 * already charged against them; asking the IM to retroactively approve the working set would
 * empty every picker on deploy. The column default is therefore ACTIVE for the backfill and is
 * then moved to PROPOSED for everything created afterwards.
 *
 * Their `decided_at` stays NULL, because no decision was ever made — writing `created_at` there
 * would fabricate an approval that did not happen. The CHECK below is written to tolerate that
 * rather than to force the lie: it constrains what a PROPOSED row may carry, which is a real
 * invariant, instead of demanding a decision timestamp that grandfathered rows cannot honestly
 * supply.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE project_status AS ENUM ('PROPOSED', 'ACTIVE', 'REJECTED')
  `.execute(db);

  // Default ACTIVE for the length of the backfill, so every existing row lands in use.
  await sql`
    ALTER TABLE projects
      ADD COLUMN status project_status NOT NULL DEFAULT 'ACTIVE'
  `.execute(db);

  // From here on, a new project is a proposal until somebody says otherwise.
  await sql`
    ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'PROPOSED'
  `.execute(db);

  await sql`
    ALTER TABLE projects
      ADD COLUMN decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
      ADD COLUMN decided_at timestamptz,
      ADD COLUMN decision_note text
  `.execute(db);

  /**
   * A proposal carries no decision. The converse — that a decided project must have a
   * timestamp — is deliberately NOT asserted, because the rows grandfathered to ACTIVE above
   * have no decision to record. Tightening this later is a migration; fabricating the data now
   * would be permanent.
   */
  await sql`
    ALTER TABLE projects
      ADD CONSTRAINT projects_proposal_has_no_decision
      CHECK (
        status <> 'PROPOSED'
        OR (decided_by IS NULL AND decided_at IS NULL AND decision_note IS NULL)
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_proposal_has_no_decision
  `.execute(db);

  /**
   * Dropping `status` loses the record of which projects were never accepted, and a PROPOSED
   * project reappears in every picker as though it had been. Stated rather than discovered —
   * this is inherent to reversing the feature, not an oversight.
   */
  await sql`
    ALTER TABLE projects
      DROP COLUMN IF EXISTS decision_note,
      DROP COLUMN IF EXISTS decided_at,
      DROP COLUMN IF EXISTS decided_by,
      DROP COLUMN IF EXISTS status
  `.execute(db);

  await sql`DROP TYPE IF EXISTS project_status`.execute(db);
}
