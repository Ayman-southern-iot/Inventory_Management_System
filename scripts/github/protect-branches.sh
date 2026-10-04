#!/usr/bin/env bash
# Applies the repository settings and branch protection that CONTRIBUTING.md describes.
# Run by the repository owner; it needs a token with administration on the repo
# (classic: `repo`; fine-grained: Administration read/write).
#
#   GITHUB_TOKEN=<token> bash scripts/github/protect-branches.sh
#   DRY_RUN=1 bash scripts/github/protect-branches.sh      # prints the requests, sends nothing
#
# The token comes from the environment only. It is never written to a file, a git remote URL or
# the output of this script. Safe to re-run: every call is a PUT/PATCH of the full desired state.
#
# Needs GitHub Pro/Team/Enterprise if the repository is private: free private repos cannot have
# branch protection and the API answers 403 "Upgrade to GitHub Pro".
set -eu

OWNER_REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$OWNER_REPO" ]; then
  url="$(git remote get-url origin)"
  OWNER_REPO="$(printf '%s' "$url" | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
fi
API="https://api.github.com/repos/${OWNER_REPO}"
INTEGRATION_BRANCH='advance-inventory-management'

if [ "${DRY_RUN:-0}" != "1" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN is not set (and DRY_RUN=1 was not given)." >&2
  exit 1
fi

call() { # method path json
  local method="$1" path="$2" body="$3"
  echo "-> $method $path"
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '%s\n' "$body"
    return 0
  fi
  local out code
  out="$(mktemp)"
  code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "$API$path" -d "$body")"
  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    echo "   $code ok"
  else
    echo "   $code FAILED: $(sed -E 's/"documentation_url".*//' "$out" | head -c 400)" >&2
    rm -f "$out"
    exit 1
  fi
  rm -f "$out"
}

# 1. Repository: main is the default, merge methods that match CONTRIBUTING.md section 6.
#    Squash for feature branches (the PR title becomes the commit), merge commit for
#    advance-inventory-management -> main (squashing a long-lived branch makes it diverge from
#    main). Rebase-merge is off: it rewrites SHAs and has the same divergence problem.
call PATCH "" '{
  "default_branch": "main",
  "allow_squash_merge": true,
  "allow_merge_commit": true,
  "allow_rebase_merge": false,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY",
  "delete_branch_on_merge": true,
  "allow_auto_merge": false
}'

# 2. main: pull request only, CI green and up to date, one approval, no force-push, no delete.
#    enforce_admins=false on purpose: while there is one maintainer, an owner who could not merge
#    their own reviewed PR would be locked out. Turn it on when a second maintainer exists.
call PUT "/branches/main/protection" '{
  "required_status_checks": { "strict": true, "contexts": ["commit-lint", "verify"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}'

# 3. advance-inventory-management: developers push to it directly, so it must NOT require a
#    pull request or a status check (a required check blocks any direct push whose commit has not
#    already been checked). It is protected from history rewrites and deletion; CI still runs on
#    every push, and the pull request into main is the gate.
call PUT "/branches/${INTEGRATION_BRANCH}/protection" '{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}'

echo "Done. Verify at https://github.com/${OWNER_REPO}/settings/branches"
