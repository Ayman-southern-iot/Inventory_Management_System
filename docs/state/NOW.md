# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-02

## Where the build is

**Phases 00–08 complete**, plus three rounds of Ayman's own QA against the running app. The money
surface refuses what it cannot pay for, the carriage is recorded on the purchase that paid it,
requesters no longer need a stand-in to approve their own requisition, and the BOM prints five
items to a page on plain A4. Partial funding is switched **off** for this release behind
`ALLOW_PARTIAL_FUNDING` (config, default false) — a receipt must clear the whole balance.

## Next action

**Nothing is queued — ask before starting.** In the order I would take them:

1. **The two hard blockers below.** `IMS-MVP-Readiness.md` has the verdict: the software passes
   28/28 end to end, but demo mode is on in production and nothing is pushed. RUNBOOK §0 is the
   checklist.
2. **The expenses page rebuild is done** (`docs/spec/expenses-page-rebuild.md`) — but two conflicts
   in that spec need Ayman's ruling, recorded in `IMS-Critical-Flow-Run.md` §8.
3. The **expenses page rebuild** (`docs/spec/expenses-page-rebuild.md`). Its investigation is
   answered and all four preconditions are met, but **two conflicts in the spec need Ayman's
   ruling first** — see `IMS-Critical-Flow-Run.md` §8. Do not build to the literal spec.
4. `G-14`'s prevention half · `OQ-30` · `OQ-31`.

## Green as of 2026-09-02 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 20 · api 83 · web 299
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0030** applied.
- **29/29 MVP end-to-end + 62/62 critical-flow checks pass** (`IMS-Critical-Flow-Run.md`), including TC-319 —
  the carriage leaving with a voided purchase, which is OQ-32 exercised for the first time.
- `pnpm --filter @ims/api test:int` → **685 pass / 0 fail / 0 skipped (50 files)**. No skipped tests.

## Needs the operator

1. **`git push` is still not authorised — ~152 commits ahead of `main`.** Everything since QA
   round 2 exists on this machine only. The single largest risk.
2. **Demo mode is ON in production — there is effectively no authentication.**
   `GET /auth/demo-accounts` answers unauthenticated with every email and the shared password,
   admin included. Set `DEMO_ACCOUNTS_ENABLED=false`, recreate the api, reset all five passwords.
3. Offsite backups (**G-16**) and a drill against the real compose stack (**G-17**).
4. A fresh install processes no requisition until an admin sets the sub-threshold approver,
   approver slots, an IM and a department. The seed creates none of them.

## Landmines — full list in `ASSIST.md` §9

- **A backtick inside any `` `…` `` template literal ends it.** Also: a quoted heredoc in this
  shell eats backslashes — write scripts with the Write tool, not `<<'EOF'`.
- **Built output goes stale, and lies confidently.** Rebuild `apps/api/dist` before measuring the
  PDF; a config default does not reach the stack until `docker compose up -d --build` at the root.
- **Two compose files.** `pnpm db:up` is the dev database only; the app stack is root compose.
- **The API rate limits, correctly.** 300 authenticated req/60s per IP and 10 logins/60s. A test
  harness trips both and it looks like a broken app — pace it, cache tokens, back off on 429.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **`D-nnn` is the QA defect numbering — never use it for a decision.** Cite by `OQ-*` / `G-*`.
- **`resetData` keeps requisitions**, so money accumulates across a spec file.
- **Never return `this.funding()` from inside its own transaction.**
- Never `npx`/`npm` at the root. **`test:int -- <spec>` does not filter**; use
  `vitest run --config vitest.integration.config.ts <pattern>`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` ·
`OQ-33`. **OQ-07, OQ-32, OQ-34 and G-20 closed.**
