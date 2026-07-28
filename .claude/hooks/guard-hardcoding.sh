#!/usr/bin/env bash
# Flags the common hardcoding violations after an edit.
# Wired as a PostToolUse hook on Write|Edit. Also runnable manually:
#   .claude/hooks/guard-hardcoding.sh --scan-all
#   .claude/hooks/guard-hardcoding.sh path/to/file.ts
#
# Exit 0 always for a single file (advisory, printed to Claude); exit 1 in --scan-all
# so it can be used in CI.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

collect_target() {
  if [ "${1:-}" = "--scan-all" ]; then
    git -C "$ROOT" ls-files '*.ts' '*.tsx' 2>/dev/null \
      | grep -vE '(\.spec\.|\.test\.|\.config\.ts|/config/|/i18n/|/migrations/|/test/|\.d\.ts)' || true
  elif [ -n "${1:-}" ]; then
    echo "$1"
  else
    # PostToolUse: tool payload arrives as JSON on stdin
    python3 - <<'PY' 2>/dev/null || true
import sys, json
try:
    d = json.load(sys.stdin)
    p = (d.get("tool_input") or {}).get("file_path") or ""
    if p: print(p)
except Exception:
    pass
PY
  fi
}

check_file() {
  local f="$1" hits=0
  [ -f "$f" ] || return 0
  case "$f" in
    *.ts|*.tsx) ;;
    *) return 0 ;;
  esac
  # Excluded because they ARE the configuration layer, or run outside the app entirely:
  #   */config/*      the typed config module itself
  #   */i18n/*        user-facing copy lives here on purpose
  #   */migrations/*  schema literals are the point of a migration
  #   *.config.ts     vite/vitest/nest configs run in Node before the app exists, so they
  #                   cannot import the typed config they are helping to build
  #   */test/*        the test harness must point env at the throwaway database
  case "$f" in
    */config/*|*/i18n/*|*/migrations/*|*/test/*|*.config.ts|*.spec.ts|*.test.ts|*.test.tsx|*.d.ts)
      return 0 ;;
  esac

  emit() { echo "  $f: $1"; hits=$((hits+1)); }

  grep -nE 'process\.env' "$f" >/dev/null 2>&1 \
    && emit "reads process.env directly — import the typed config module instead"
  grep -nE '\b(15000|15_000)\b' "$f" >/dev/null 2>&1 \
    && emit "expense threshold as a literal — read it from SettingsService"
  grep -nE "['\"](https?://(localhost|127\.0\.0\.1)[^'\"]*)['\"]" "$f" >/dev/null 2>&1 \
    && emit "hardcoded localhost URL — use config.apiBaseUrl"
  grep -nE "#[0-9a-fA-F]{6}\b" "$f" >/dev/null 2>&1 \
    && emit "hex colour — use a semantic design token"
  grep -nE "(role|status)\s*(===|!==)\s*['\"]" "$f" >/dev/null 2>&1 \
    && emit "role/status compared to a string literal — use the enum"
  grep -nE "\b(password|secret|apiKey|api_key|token)\s*[:=]\s*['\"][^'\"]{6,}" "$f" >/dev/null 2>&1 \
    && emit "possible hardcoded credential"
  grep -nE "\[[0-9]{2,4}px\]|\bw-\[|\bh-\[|\btext-\[" "$f" >/dev/null 2>&1 \
    && emit "arbitrary Tailwind value — use the token scale"

  return $hits
}

TARGETS="$(collect_target "${1:-}")"
[ -z "$TARGETS" ] && exit 0

TOTAL=0
OUT=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  RES="$(check_file "$f")"
  N=$?
  if [ "$N" -gt 0 ]; then OUT="${OUT}${RES}"$'\n'; TOTAL=$((TOTAL+N)); fi
done <<< "$TARGETS"

if [ "$TOTAL" -gt 0 ]; then
  echo "no-hardcoding guard — $TOTAL potential violation(s):"
  echo "$OUT"
  echo "See .claude/rules/10-no-hardcoding.md. If one is a genuine exception, name the constant."
  [ "${1:-}" = "--scan-all" ] && exit 1
fi
exit 0
