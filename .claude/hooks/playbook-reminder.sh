#!/usr/bin/env bash
# PostToolUse hook — advisory reminder to update AI_PLAYBOOK.md after meaningful edits.
#
# Why this exists: AI_PLAYBOOK.md is the single orientation document for any AI assistant
# working on this repo. Without a reminder, the playbook rots the moment a phase lands and
# the next session burns thousands of tokens re-deriving context the playbook was supposed
# to carry.
#
# Design notes:
#  - Advisory, not blocking. Exit 0 always. The reminder is a prompt to Claude, not a gate.
#  - No JSON dependency for non-PostToolUse invocations — graceful in all modes.
#  - Uses python3 because the same machine has it (proven by guard-hardcoding.sh) and the
#    alternative is `jq`, which is NOT installed on the build machine.
#  - Accepts the touched file via:
#      1. PostToolUse JSON on stdin (the normal Claude Code path), or
#      2. As $1 (manual invocation: `playbook-reminder.sh path/to/file.ts`), or
#      3. From the `file_path` line in stdin (some environments flatten the JSON).
#  - Only reminds when the touched file is "playbook-relevant" (config, migrations, modules,
#    rules, skills, infra, plan, root scripts). A test edit doesn't trigger it; a schema
#    change does.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PLAYBOOK="$ROOT/AI_PLAYBOOK.md"

# Resolve the target file from any of the supported inputs.
resolve_target() {
  # 1. Explicit argument
  if [ -n "${1:-}" ]; then
    echo "$1"; return 0
  fi
  # 2. JSON payload on stdin
  local from_json
  from_json="$(python3 - <<'PY' 2>/dev/null || true
import sys, json
try:
    raw = sys.stdin.read()
    if not raw.strip(): sys.exit(0)
    d = json.loads(raw)
    p = (d.get("tool_input") or {}).get("file_path") or ""
    if p: print(p)
except Exception:
    pass
PY
)"
  if [ -n "$from_json" ]; then
    echo "$from_json"; return 0
  fi
  # 3. Bare file_path line on stdin (some shells strip the JSON wrapper)
  local raw
  raw="$(cat 2>/dev/null || true)"
  if [ -n "$raw" ]; then
    echo "$raw" | awk '/^"?file_path"?[[:space:]]*[:=]/ { gsub(/[" ]/, ""); sub(/^file_path[:=]/, ""); print; exit }'
  fi
}

# Files whose change is playbook-relevant. Match against the absolute path, prefix-style.
is_relevant() {
  local f="$1"
  # Exclusions first: tests, the playbook itself, its rule, its hook.
  case "$f" in
    *.spec.ts|*.test.ts|*.test.tsx|*/test/*|*/__tests__/*) return 1 ;;
    "$ROOT"/AI_PLAYBOOK.md|"$ROOT"/.claude/rules/05-ai-playbook.md|"$ROOT"/.claude/hooks/playbook-reminder.sh) return 1 ;;
  esac
  case "$f" in
    # Repo layout / commands
    "$ROOT"/package.json|"$ROOT"/pnpm-workspace.yaml|"$ROOT"/tsconfig.base.json) return 0 ;;
    # Plan + reference docs + state (so commands/landmines get updated)
    "$ROOT"/plan/*|"$ROOT"/docs/reference/*|"$ROOT"/docs/state/*) return 0 ;;
    # Rules, skills, agents, hooks (playbook mirrors these)
    "$ROOT"/.claude/rules/*|"$ROOT"/.claude/skills/*|"$ROOT"/.claude/agents/*|"$ROOT"/.claude/hooks/*|"$ROOT"/.claude/settings.json) return 0 ;;
    # Backend modules (the module list in §3 + conventions in §9)
    "$ROOT"/apps/api/src/modules/*|"$ROOT"/apps/api/src/config/*|"$ROOT"/apps/api/src/database/*) return 0 ;;
    # Frontend features / routes / i18n (conventions in §10)
    "$ROOT"/apps/web/src/features/*|"$ROOT"/apps/web/src/routes/*|"$ROOT"/apps/web/src/i18n/*|"$ROOT"/apps/web/src/styles/*|"$ROOT"/apps/web/src/api/*) return 0 ;;
    # Shared package (enums, contracts, settings registry — §12)
    "$ROOT"/packages/shared/*) return 0 ;;
    # Infra (commands §4, infra rules §14)
    "$ROOT"/infra/*|"$ROOT"/Dockerfile*|"$ROOT"/docker-compose*.yml) return 0 ;;
  esac
  return 1
}

TARGET="$(resolve_target "${1:-}")"
[ -z "$TARGET" ] && exit 0

# Normalize the path to an absolute form so the case patterns below can match.
case "$TARGET" in
  /*) ;;
  *)  TARGET="$ROOT/$TARGET" ;;
esac

# Convert Windows-style backslashes to forward slashes (the patterns assume POSIX).
TARGET="${TARGET//\\//}"

if is_relevant "$TARGET"; then
  cat <<'MSG' >&2

[AI_PLAYBOOK] Reminder: you just edited a playbook-relevant file. Before finishing this
edit, ask: does AI_PLAYBOOK.md still describe the project accurately? If you added or
removed a module, command, port, rule, skill, agent, landmine, or convention — or changed
anything in plan/, docs/state/, or docs/reference/ — update the relevant section of
AI_PLAYBOOK.md and bump the "Last updated:" date. See .claude/rules/05-ai-playbook.md.

MSG
fi
exit 0