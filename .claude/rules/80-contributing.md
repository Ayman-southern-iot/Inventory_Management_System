# Contributing rules (for every Claude Code session on this repo)

Several developers push here, each with their own Claude Code. The human-readable version is
`CONTRIBUTING.md`; this is the part you must not get wrong. Kept short: it loads every session.

## Branches

- **Never push to `main`.** It takes pull requests only. `.claude/settings.json` denies it.
- The team's branch is `advance-inventory-management`: `git pull` it first, then push to it.
  Never `--force`, never delete it.
- Other branches are `<type>/<kebab-name>`, type = feat fix docs chore test refactor perf build ci hotfix.
- Cut a branch from `main` or `advance-inventory-management`, not from a leftover branch. A new
  branch inherits its upstream; push by name: `git push -u origin <branch>`.

## Commits

- Conventional: `<type>(<scope>): <subject>`, header ≤ 100 chars, no trailing full stop, blank
  line before a body. `scripts/check-commit-message.sh` is the definition; the hook and CI both run it.
- One logical change per commit; a migration and its code together.
- **Never `--no-verify`** (commit or push). If a hook is wrong, say so and fix the hook in a PR.
- Keep the `Co-Authored-By` trailer. Do not commit unless the developer asked.

## Before you say a change is ready to push

- `pnpm typecheck`, `pnpm lint` (exit 0), `pnpm test` — and the targeted integration spec if you
  touched stock, db, auth or the API. Show the output; never write "should pass".
- Run the `code-reviewer` agent on the diff; add `security-reviewer` for auth, roles, permissions
  or file upload. Report what they found.
- Repo invariants CI checks, so do not trip them: no tracked `.env`; `process.env` only in
  `apps/api/src/config/`; no `synchronize: true`; **never edit, rename or delete an existing
  migration (write a new one)**; no newly added `.skip` / `.only`.

## Not yours

- `docs/state/*` is the lead's snapshot. On a feature branch do not run `/handoff` into it or
  edit it; put notes in the PR description. Open questions are the exception: add an `OQ-*` to
  `docs/state/OPEN-QUESTIONS.md` in the PR when the spec is silent.
- Never read, print or commit `.env`, a token, or any secret value; name the key instead.
