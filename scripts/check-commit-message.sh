#!/usr/bin/env bash
# The one definition of "a commit message this repo accepts".
#
# Used by .githooks/commit-msg (your machine), .githooks/pre-push (catches commits made before
# the hooks were installed, or with --no-verify) and the commit-lint job in CI (which is what
# actually enforces it, because a local hook can always be skipped).
#
#   scripts/check-commit-message.sh <message-file>   or   ... - < message
#
# Format: Conventional Commits, as .claude/rules/00-engineering-standards.md already requires.
#   <type>(<scope>)<!>: <subject>
set -u

TYPES='feat|fix|docs|chore|test|refactor|perf|build|ci|revert|style'
HEADER_MAX=100

SRC="${1:--}"
if [ "$SRC" = "-" ]; then MSG="$(cat)"; else MSG="$(cat "$SRC")"; fi

# git's own comment lines (the commit template) are not part of the message
CLEAN="$(printf '%s\n' "$MSG" | tr -d '\r' | grep -v '^#' || true)"
HEADER="$(printf '%s\n' "$CLEAN" | sed -n '1p')"
SECOND="$(printf '%s\n' "$CLEAN" | sed -n '2p')"

fail() {
  {
    echo "REJECTED commit message: $1"
    echo "  header: $HEADER"
    echo
    echo "  Required:  <type>(<scope>): <subject>        e.g.  fix(stock): lock the placement before the ledger insert"
    echo "  types:     ${TYPES//|/ }"
    echo "  scope:     optional, lowercase module/area (requisitions, stock, web, api, infra, docs ...)"
    echo "  subject:   what changed and why it matters, <= ${HEADER_MAX} chars on the header, no trailing full stop"
    echo "  breaking:  add '!' after the scope, and a 'BREAKING CHANGE:' footer"
    echo "  Full rules: CONTRIBUTING.md section 3"
  } >&2
  exit 1
}

[ -n "$HEADER" ] || fail "empty message"

# Merge and revert commits git writes itself are allowed as-is.
case "$HEADER" in
  "Merge "* | 'Revert "'*) exit 0 ;;
esac

# `git commit --fixup` is fine on your machine (you will rebase it away); never in a PR.
case "$HEADER" in
  "fixup! "* | "squash! "* | "amend! "*)
    [ "${COMMIT_MSG_ALLOW_FIXUP:-0}" = "1" ] && exit 0
    fail "fixup!/squash! commits must be squashed before the push"
    ;;
esac

PATTERN="^(${TYPES})(\\([a-z0-9][a-z0-9,_./-]*\\))?!?: [^ ].*$"
[[ "$HEADER" =~ $PATTERN ]] || fail "header is not '<type>(<scope>): <subject>'"

[ "${#HEADER}" -le "$HEADER_MAX" ] || fail "header is ${#HEADER} chars, the limit is ${HEADER_MAX}"

case "$HEADER" in
  *.) fail "header ends with a full stop" ;;
esac

# Subject of only filler is the same as no subject.
SUBJECT="${HEADER#*: }"
case "$(printf '%s' "$SUBJECT" | tr '[:upper:]' '[:lower:]')" in
  wip | wip.* | update | updates | fix | fixes | changes | stuff | misc | temp | tmp | test | asdf)
    fail "subject '$SUBJECT' says nothing; name what changed"
    ;;
esac

[ -z "$SECOND" ] || fail "line 2 must be blank (header, blank line, then body)"

exit 0
