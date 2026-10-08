# Contributing

Rules for everyone who pushes to this repository, whether they type the code or Claude Code does.
The rules are enforced three times: a local git hook (saves you a round trip), CI (the real
check), and branch protection (nobody can skip CI). `--no-verify` skips only the first.

## 1. Branches

```
main                           protected. Production-ready. Changes arrive by pull request only.
 └─ advance-inventory-management   the team's integration branch. Developers pull it, push to it.
     (short-lived branches are optional: feat/…, fix/…)
```

| Branch | Who pushes | How it gets to the next stage |
|---|---|---|
| `main` | nobody directly | pull request, CI green, reviewed and merged by the lead |
| `advance-inventory-management` | developers, directly, after pulling | pull request into `main` |
| `<type>/<name>` | the author | pull request into `main` or `advance-inventory-management` |

Never push to `main`. Never force-push to either long-lived branch. Never delete them.

## 2. Branch names

`<type>/<short-kebab-description>` where type is `feat fix docs chore test refactor perf build ci hotfix`:
`feat/borrow-return-flow`, `fix/approver-count-zero`. Lowercase, digits, `-` `.` `_` only.
The one exception is `advance-inventory-management`. (GitHub branch names cannot contain spaces.)

## 3. Commit messages

[Conventional Commits](https://www.conventionalcommits.org). Checked by `scripts/check-commit-message.sh`.

```
<type>(<scope>): <subject>

<optional body: why, not what>

<optional footers: BREAKING CHANGE: …, Refs: OQ-35>
```

- **type**: `feat fix docs chore test refactor perf build ci revert style`
- **scope**: optional, lowercase, the module or area: `requisitions`, `stock`, `funds`, `boms`,
  `imports`, `web`, `api`, `infra`, `state`. Two scopes: `fix(web,api): …`
- **subject**: what changed and why it matters. Header ≤ 100 characters, no trailing full stop.
  `wip`, `update`, `fix`, `changes` and the like are rejected: they say nothing.
- **breaking change**: `feat(api)!: …` plus a `BREAKING CHANGE:` footer.
- Blank line between header and body.

```
✔ fix(stock): lock the placement before the ledger insert
✔ feat(imports): refuse a file that changes more shelves than IMPORT_MAX_CHANGED_SHELVES
✘ Fixed bug            ✘ WIP: half done           ✘ feat(Stock): Added thing.
```

One logical change per commit. A migration and the code that uses it go in the **same** commit.
`fixup!` / `squash!` commits are fine on your machine and rejected on push; squash them first.

The pull request **title** follows the same rule (squash merge makes it the commit on `main`).

## 4. Day to day

One-time, after cloning:

```bash
pnpm install
pnpm hooks:install            # commit-msg + pre-push hooks, pull.rebase=true
```

Every change:

```bash
git switch advance-inventory-management
git pull                      # rebases your local work onto the team's
# … work, commit (hook checks the message) …
git pull                      # again, right before pushing
git push origin advance-inventory-management
```

If the push is rejected, someone pushed first: `git pull` and push again. **Never** `--force`.
The `pre-push` hook then runs typecheck and lint; it refuses a red push.

## 5. Before you push: the gate

```bash
pnpm typecheck
pnpm lint                     # must exit 0
pnpm test
pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts <pattern>   # if you touched stock, db, auth, api
bash .claude/hooks/guard-hardcoding.sh --scan-all   # if you added any literal (baseline: 8 findings, do not add)
```

New behaviour needs a test that **fails without your change**. A failing test is never skipped,
deleted or rewritten to get green; CI rejects a newly added `.skip` / `.only`.

## 6. Review, and what gets merged how

**Before pushing, review your own diff** against this repository, not in general:

- Claude Code users: run the `code-reviewer` agent on the diff. If you touched login, roles,
  permissions or file upload, also the `security-reviewer` agent.
- Everyone: read `git diff` line by line. If you cannot explain a line, it is not ready.

**Pull request into `main`** (the gate that matters). The template asks for the basis of the
behaviour, real command output, and anything new (migration, `ErrorCode`, setting, dependency).
The reviewer, the lead (Arif), checks the project invariants first, and is the only one who merges:

1. No hardcoded values: env → config module, business values → `app_settings`. (`.claude/rules/10-no-hardcoding.md`)
2. Only `StockService` writes `stock_placements` / `stock_ledger`, in one transaction with a ledger row.
3. Schema change = a **new** migration file. An applied migration is never edited.
4. A new behaviour with no spec basis has an `OQ-*` entry, not a silent guess.
5. A new `ErrorCode` has its user-facing copy in `apps/web/src/i18n/en.ts`.

How to merge: **feature branch → `main`: squash** (one commit, title = PR title).
**`advance-inventory-management` → `main`: merge commit, never squash** (squashing a long-lived
branch makes it diverge from `main`). Rebase-merge is disabled. After a merge into `main`, pull
`main` back into `advance-inventory-management` so they stay level.

CI jobs: `commit-lint`, `verify` (repo invariants, typecheck, lint, unit tests) and `integration`.
The first two are required on `main`. Repo invariants fail the build on: a tracked `.env`,
`process.env` outside `apps/api/src/config/`, `synchronize: true`, an edited/deleted/renamed
migration, a newly added `.skip` / `.only`.

## 7. Hotfix

`git switch main && git pull && git switch -c hotfix/<name>`; fix; pull request into `main`; once
merged, merge `main` into `advance-inventory-management`.

## 8. Working with Claude Code

Claude Code loads this repo's rules (`CLAUDE.md`, `.claude/`) automatically; the same rules apply
to it as to you.

- You are responsible for what it commits. Read the diff. Its `Co-Authored-By` trailer stays.
- It must not use `--no-verify`, push to `main`, or force-push. `.claude/settings.json` denies those.
- It never merges a pull request, not even from the lead's account, unless the lead says
  "merge #N" for that one.
- Do not paste secrets or a `.env` into a prompt. `.env` is gitignored and must stay so.
- **`docs/state/` is the lead's snapshot** (`NOW.md` is rewritten whole and injected into every
  session). Do not commit changes to it from a feature branch: two developers' `/handoff` will
  conflict every time. Put your session notes in the PR description.
- Questions the spec does not answer go to `docs/state/OPEN-QUESTIONS.md` via the PR, marked
  `// OPEN QUESTION: <id>` in code. Never invent a requirement.

## 9. Secrets

Never commit `.env`, tokens, dumps or generated PDFs. If one is committed, assume it is leaked:
**rotate it first**, then remove it. Deleting the commit does not unleak it. Use a fine-grained
GitHub token scoped to this one repository, with an expiry.

## 10. If a rule is wrong

Fix the rule, in a pull request, with the reason. Do not route around it. The files:
`scripts/check-commit-message.sh`, `.githooks/`, `scripts/ci/repo-invariants.sh`,
`.github/workflows/ci.yml`, `.github/pull_request_template.md`, `.github/CODEOWNERS`,
`scripts/github/protect-branches.sh` (repo settings and branch protection).
