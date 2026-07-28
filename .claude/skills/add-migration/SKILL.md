---
name: add-migration
description: Write a database migration safely. Use whenever the schema changes — new table, column, index, constraint, or enum value.
argument-hint: "[what is changing]"
allowed-tools: Read Grep Glob Bash(pnpm db:*)
---

Migration: **$ARGUMENTS**

## Before writing anything

1. Read `.claude/rules/40-database.md`.
2. Check `docs/reference/07-data-model.md` for the intended shape. If your change contradicts it,
   stop — either the doc is wrong (update it and record why) or your change is.
3. Ask: **is this destructive?** Dropping or renaming a column, tightening a constraint, or changing
   a type is destructive. Destructive changes are split across two releases, never done in one.

## Write it

- [ ] `pnpm db:make <descriptive_name>`
- [ ] `up()` and a real `down()`. A `down()` that throws is acceptable only for a genuinely
      irreversible change, and then it says so in a comment.
- [ ] Additive: new columns nullable, backfill in a separate step, tighten later.
- [ ] Constraints included — `CHECK`, `UNIQUE`, `FOREIGN KEY`. This is the cheapest correctness
      you will ever buy.
- [ ] Indexes for the queries this change enables.
- [ ] No business data in the migration. Reference data goes in an idempotent seed.
- [ ] Long-running index builds on an existing table use `CREATE INDEX CONCURRENTLY` outside a
      transaction.

## Prove it

```bash
pnpm db:migrate            # applies
pnpm db:rollback           # reverses cleanly
pnpm db:migrate            # re-applies
pnpm test                  # nothing broke
```

Then run it once more against a copy of seeded data, not just an empty schema — empty-database
migrations hide backfill bugs. Record the result in the task's checkbox notes.
