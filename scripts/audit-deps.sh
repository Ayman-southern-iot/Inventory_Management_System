#!/usr/bin/env bash
# Fail-closed dependency audit. The whole point of this script is that we want to know when
# dependencies have known vulnerabilities; that means a failed network call MUST report as
# failure, never as "no vulnerabilities found".
#
# Exit codes:
#   0 — audit ran, no actionable vulnerabilities (low/info only is fine)
#   1 — audit ran AND found actionable vulnerabilities (critical/high/moderate)
#   2 — audit could not run (network/registry/parse error) — refuses to mark deps clean
#
# We deliberately do not parse the pnpm JSON ourselves for the "found vuln" case unless we
# have to; the textual summary line is sufficient for a CI-friendly one-liner.

set -Eeuo pipefail

OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT

# `--prod false` keeps devDependencies in scope: linting, typescript, prettier get audited too.
# The `--audit-level` is the lowest severity we want to fail on; `moderate` matches the plan.
if ! pnpm audit --json --audit-level moderate >"$OUT" 2>"$ERR"; then
  # pnpm audit exits non-zero for either "found vulnerabilities" OR "could not run".
  # Disambiguate by reading its stdout — a real result is always a JSON document.
  if head -c1 "$OUT" | grep -q '{'; then
    cat "$OUT"
    echo
    echo "Vulnerabilities above the moderate threshold were found. Run \`pnpm audit\` for details."
    exit 1
  fi
  printf 'pnpm audit failed (likely offline or registry unreachable). Refusing to mark deps clean.\n' >&2
  cat "$ERR" >&2 || true
  exit 2
fi

# pnpm audit exited 0 with a JSON document — that means no actionable vulnerabilities.
node -e "
  const r = JSON.parse(require('fs').readFileSync('$OUT','utf8'));
  const v = (r && r.metadata && r.metadata.vulnerabilities) || {};
  const bad = (v.critical||0) + (v.high||0) + (v.moderate||0);
  if (bad > 0) {
    console.error('Vulnerabilities remain:', v);
    process.exit(1);
  }
  console.log('No actionable vulnerabilities (critical/high/moderate).');
"
