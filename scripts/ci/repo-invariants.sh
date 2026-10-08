#!/usr/bin/env bash
# Repo rules a compiler cannot see. Each one is a rule from CLAUDE.md / .claude/rules that has
# already cost this project a bad day, checked mechanically so review does not depend on
# someone remembering.
#
#   scripts/ci/repo-invariants.sh [base-ref]      default base: origin/main
#
# Checks 1-3 look at the tree; 4-5 look at what this branch changes relative to the base.
set -u

BASE="${1:-origin/main}"
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0

bad() { echo "VIOLATION: $1" >&2; shift; printf '  %s\n' "$@" >&2; fail=1; }

# 1. No secrets files. .env.example is the only .env a repo may hold.
envs="$(git ls-files | grep -E '(^|/)\.env(\..*)?$' | grep -vE '\.example$' || true)"
[ -z "$envs" ] || bad "an env file is tracked (never commit .env, rule 00-engineering-standards Git)" $envs

# 2. process.env is read in the config module only (rule 10-no-hardcoding).
penv="$(git ls-files 'apps/api/src' | grep -v '^apps/api/src/config/' | xargs grep -ln 'process\.env' 2>/dev/null || true)"
[ -z "$penv" ] || bad "process.env outside apps/api/src/config/ (rule 10-no-hardcoding)" $penv

# 3. The schema is changed by migration files only (CLAUDE.md rule 3).
sync="$(git ls-files 'apps/api/src' | xargs grep -ln 'synchronize:[[:space:]]*true' 2>/dev/null || true)"
[ -z "$sync" ] || bad "synchronize: true (schema changes are migration files only)" $sync

if git rev-parse --verify --quiet "$BASE" >/dev/null; then
  # 4. An applied migration is never edited, renamed or deleted; a fix is a NEW migration.
  changed="$(git diff --name-status --diff-filter=MDR "$BASE"...HEAD -- apps/api/src/database/migrations || true)"
  [ -z "$changed" ] || bad "an existing migration was modified/deleted/renamed (CLAUDE.md rule 3: write a new one)" "$changed"

  # 5. A test is never skipped or focused to get green (rule 70-assist-handoff STOP list).
  focused="$(git diff -U0 "$BASE"...HEAD -- '*.spec.ts' '*.int-spec.ts' '*.test.ts' '*.test.tsx' \
    | grep -E '^\+[^+]' | grep -E '(\.only\(|\.skip\(|\bxit\(|\bxdescribe\(|\bfit\(|\bfdescribe\()' || true)"
  [ -z "$focused" ] || bad "a test was skipped or focused in this branch" "$focused"
else
  echo "note: base '$BASE' not found; skipped the diff checks (4, 5)" >&2
fi

[ "$fail" -eq 0 ] && echo "repo-invariants: ok"
exit "$fail"
