# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-01

## Where the build is

**Phases 00–08 complete.** Since then, two rounds of Ayman's own QA against the running app —
`IMS-QA-Report.md` (43 findings) plus six more items on 2026-08-31 and six on 2026-09-01. All
delivered, OQ-34 included (plain white A4, so the BOM top margin is 20mm and five items fit a
page). Highlights: the money surface now refuses what it cannot pay for (BOM ≤ approved, purchase ≤ funded), the carriage is recorded on the purchase that
paid it, requesters no longer need a stand-in to approve their own requisition, and the requisition
detail and BOM document were rebuilt from Ayman's templates.

## Next action

**Nothing is queued — ask before starting.** In the order I would take them:

1. **The operator blockers below**, now the only thing standing between this and go-live.
2. `G-14`'s prevention half (`BorrowingService.create` reserves and inserts in two transactions —
   wants a ruling on widening the one-writer boundary) · `OQ-30` · `OQ-31`.

## Green as of 2026-09-01 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 13 · api 76 · web 296
- `pnpm --filter @ims/api test:int` → **684 pass / 0 fail (49 files)**
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0030** applied. **0029** (carriage on the purchase) and **0030** (approver
  count may be 0) are new and were each verified down → up.

## Needs the operator

1. **`git push` is still not authorised — 149 commits ahead of `main`, 76 ahead of `origin`.**
   Everything since QA round 2 exists on this machine only. The single largest risk.
2. **Demo mode is ON in production** — login lists five accounts with a shared password.
3. Offsite backups (**G-16**) and a drill against the real compose stack (**G-17**).
4. A fresh install processes no requisition until an admin sets the sub-threshold approver,
   approver slots, an IM and a department. The seed creates none of them.

## Landmines — full list in `ASSIST.md` §9

- **A backtick inside any `` `…` `` template literal ends it.** Bit three times in one session, in
  SQL *and* in the PDF's CSS. Write those comments without backticks.
- **Port 5173 is the Docker build, not a dev server** — your working tree is not there. To see
  it: `WEB_PORT=5199 VITE_DEV_API_PROXY_TARGET=http://localhost:5173 pnpm --filter @ims/web dev`.
- **Built output goes stale, and lies confidently.** `apps/api/dist` must be rebuilt before
  anything measures the PDF; a config default (`PDF_MARGIN_TOP_MM` is now 20) does not reach
  the stack until `docker compose up -d --build` at the repo root.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **`D-nnn` is the QA defect numbering — never use it for a decision.** Cite by `OQ-*` / `G-*`.
- **`resetData` keeps requisitions**, so money accumulates across a spec file.
- **Never return `this.funding()` from inside its own transaction.**
- **Two compose files.** `pnpm db:up` is `infra/docker-compose.dev.yml` — the dev database only.
  The app stack is `docker compose up -d --build` at the root. Neither substitutes for the other.
- **Windows reserves port blocks at boot; 5173, 5433 and 5434 can all land in one.** The proxy
  refuses to bind and the integration suite dies on `ECONNREFUSED :5434`, while `docker ps` says
  everything is running and nothing is listening. Fix: `RUNBOOK.md` §7.
- Never `npx`/`npm` at the root. **`test:int -- <spec>` does not filter**; use
  `vitest run --config vitest.integration.config.ts <pattern>`.

## Open debt

`G-14` (prevention half) · `G-16` · `G-17` · `G-18` · `G-19` · **`G-20` (4 paused reversal
tests — un-skip once the port is fixed)** · PM 6/12/14/15 ·
`OQ-30` · `OQ-31` · `OQ-33` (untracked xlsx / docs/policy). **OQ-07, OQ-32 and OQ-34 closed.**
