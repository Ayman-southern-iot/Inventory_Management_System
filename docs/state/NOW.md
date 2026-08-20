# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` (operating manual, symptom→cause table, landmines) · `SESSION-LOG.md` ·
> `DECISIONS.md` · `OPEN-QUESTIONS.md` · `.claude/rules/70-assist-handoff.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-08-20

## Where the build is

Phases 00–06 complete. Not construction any more — a **QA round from the project manager** is in
flight: 18 items triaged, **9 fixed, 4 answered from the requirements, 1 declined, 4 open.**
Branch `fix/lan-secure-context` is **82 commits ahead of `main`, never merged** — the largest
standing risk on this project.

## Next action

Ayman authorised a numbered list; **5c and 5d remain**, one commit each:

- **5c** — `returnedAmount` defaults to `funding.unspent`, not `'0'` (`FundsActionDialog.tsx:82`;
  the dialog already shows `funding.unspent` at :277).
- **5d** — bound `purchasedAt`/`receivedAt` to not-in-the-future, zod refine + custom message.
  **Backdating stays allowed** — event dates, not entry timestamps (`contracts/funds.ts:65`).

Then two `ASSIST.md` §8 rows (see SESSION-LOG). PM item 6 is deferred — absent, not broken.

## Green as of 2026-08-20 — measured this session, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 7 · api 51 · web 102
- `pnpm --filter @ims/api test:int` → **484 pass / 7 fail (491 tests, 40 files)**
- `pnpm lint` → **21 pre-existing errors. Lint is NOT green**, so the repo cannot currently meet
  its own definition of done. Compare the count against 21; do not expect zero.

**The 7, attributed** (misrecorded as "8" and unexplained for months): 3 × `reports` cross-file
`app_settings` pollution (pass in isolation) · 3 × Chromium not installed · **1 real defect** —
oversized JSON body returns 500 not 413, as `express.json()` errors are not `HttpException`
and never reach `codeForStatus`.

## Needs the operator — nobody else can do these

1. **`cd apps/api && npx puppeteer browsers install chrome`** — the binary was never downloaded
   (`executablePath()` resolves, file absent). Clears 3 of the 7; until then nobody here can
   verify the BOM PDF path end to end.
2. Offsite backups (**G-16**) and the production restore drill (**G-17**).
3. Set approver slots 1/2, the **sub-threshold approver** (a separate setting, the most-missed
   one), and the expense threshold. Appoint a second IM and a third approver.
4. **Ask the PM:** should a delegate see their delegated approvals in their own "Approved" tab?
   Currently no — filtered on `assigned_user_id`. One `OR` reverses it; cheap now, not later.

## Landmines — full list in `ASSIST.md` §9. The ones that bit *this* session:

- **`test:int -- <spec>` does NOT filter** — runs all 39 files, ~161s. Use
  `pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts <pattern>`.
- **`@ims/shared` resolves to `dist/`** — rebuild or a new export is invisible to typecheck.
- **Docker Desktop stops itself between sessions.** `docker info` before anything.
- **A new `config.schema.ts` key fails the suite** until pinned in `TEST_ENV` or allowlisted
  (`test/config/test-env.int-spec.ts`). Deliberate: unpinned keys inherit the dev `.env`.

## Open debt

`G-18` (upload dirs unpinned in `TEST_ENV`; allowlisted, the fix is to pin them) · `G-19` (five
endpoints return bare arrays) · PM items 6, 12, 14, 15 · money in error copy renders unformatted
(`5000`, not `5,000`) — pre-existing, worth one pass.
