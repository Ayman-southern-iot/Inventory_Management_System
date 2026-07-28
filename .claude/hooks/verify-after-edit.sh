#!/usr/bin/env bash
# Fast feedback after edits: typecheck only the workspace that changed.
# Wired as a PostToolUse hook. Never blocks — it reports.
set -uo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$ROOT" || exit 0
[ -f package.json ] || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0
OUT="$(pnpm -s typecheck 2>&1 | tail -12)"
if [ -n "$OUT" ] && echo "$OUT" | grep -qiE 'error|TS[0-9]{4}'; then
  echo "typecheck is failing:"; echo "$OUT"
fi
exit 0
