#!/usr/bin/env bash
# Run the project gate, but never while another vitest is alive.
#
# The integration suite is singleFork against one shared db-test; two runs at once truncate
# each other's rows mid-assertion and produce convincing fake regressions. That has happened
# three times in one session, each time blaming an innocent spec file, so this waits rather
# than trusting anyone to remember.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:?usage: gate.sh <output-log>}"

live() {
  powershell.exe -NoProfile -Command \
    "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*vitest*' }).Count" \
    2>/dev/null | tr -d '[:space:]'
}

waited=0
while [ "$(live)" != "0" ]; do
  if [ "$waited" -ge 900 ]; then
    echo "ABORT: a vitest process is still alive after 15 minutes; not starting a second one." | tee "$OUT"
    exit 2
  fi
  sleep 10
  waited=$((waited + 10))
done
[ "$waited" -gt 0 ] && echo "waited ${waited}s for a live vitest run to finish"

cd "$REPO" || exit 1
{
  echo "=== TYPECHECK errors ==="
  pnpm typecheck 2>&1 | grep -acE "error TS"
  echo "=== LINT ==="
  pnpm lint 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g' | grep -aE "problems"
  echo "=== TEST ==="
  pnpm test 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g' | grep -aE "^ +Tests |FAIL"
  echo "=== INT ==="
  pnpm --filter @ims/api test:int 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g' \
    | grep -aE "^ +Tests |^ +Test Files |FAIL |AssertionError"
} > "$OUT" 2>&1
echo "GATE DONE -> $OUT"
