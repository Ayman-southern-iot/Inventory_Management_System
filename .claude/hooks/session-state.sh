#!/usr/bin/env bash
# SessionStart hook — inject docs/state/NOW.md into the model's context.
#
# Why this exists: without it, every session began by reading PROGRESS.md and SESSION-LOG.md to
# work out where the build was. SESSION-LOG.md only grows, so that cost more tokens every week,
# and it happened before any actual work started. This hook hands the model a bounded brief for
# free, with no tool calls at all.
#
# The contract is one file. If NOW.md grows past ~60 lines it stops being cheap and this stops
# being worth having — keep the detail in SESSION-LOG.md and let the model go read it on demand.
#
# Uses node, not jq: this is a Node monorepo so node is guaranteed, and jq is NOT installed on
# the build machine (found the hard way — the first version of this hook exited 127 and silently
# injected nothing).
#
# Never fail the session: a broken hook here would block every start. Any problem degrades to
# "no extra context" and the model falls back to /resume.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-.}"
state_file="$root/docs/state/NOW.md"

[ -r "$state_file" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

node -e '
const fs = require("fs");
const body = fs.readFileSync(process.argv[1], "utf8");
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext:
      "Project state, auto-loaded from docs/state/NOW.md — you do NOT need to read " +
      "PROGRESS.md or SESSION-LOG.md to orient yourself:\n\n" + body,
  },
}));
' "$state_file"
