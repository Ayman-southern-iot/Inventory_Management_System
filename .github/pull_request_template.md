## What and why

<!-- One paragraph. The reason, not a restatement of the diff. PR title must be a conventional commit: `type(scope): subject` -->

## Basis

<!-- Pick one and cite it (CLAUDE.md "never invent a requirement"). -->
- [ ] `REQUIRED §n` — the requirements document says so
- [ ] `DERIVED A-n / G-n / OQ-n` — a recorded decision fills the gap
- [ ] `NO-BASIS` — neither; I added/updated an `OQ-*` in `docs/state/OPEN-QUESTIONS.md` and used the smallest default
- [ ] Defect fix in shipped behaviour (changes no decision)

## Evidence

<!-- Paste the real output, not "should pass". -->
```
pnpm typecheck
pnpm lint
pnpm test
```
- [ ] Integration run for what I touched (`pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts <pattern>`) — needed for stock, db, auth, api
- [ ] New behaviour has a test that **failed before** the change

## Declare anything new

- [ ] New migration (a new file — never an edited one)
- [ ] New `ErrorCode` **and** its copy in `apps/web/src/i18n/en.ts`
- [ ] New `app_settings` key or changed default / new `config.schema.ts` key (pinned in `TEST_ENV`)
- [ ] Any write to `stock_placements` / `stock_ledger` (only `StockService` may)
- [ ] New dependency / cron job / upload path
- [ ] None of the above

## Checklist

- [ ] No hardcoded values (`.claude/rules/10-no-hardcoding.md`); `guard-hardcoding.sh` clean for my change
- [ ] No tests skipped, deleted or rewritten to get green
- [ ] No secrets, `.env`, dumps or generated PDFs committed
- [ ] I read my own diff and can explain every line
- [ ] Touches auth / roles / permissions / file upload → I ran the `security-reviewer` agent
- [ ] I ran the `code-reviewer` agent on this diff and addressed what it found
- [ ] Written with Claude Code: yes / no &nbsp;(if yes, I reviewed the output; the `Co-Authored-By` trailer stays)
