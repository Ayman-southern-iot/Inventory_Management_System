#!/usr/bin/env bash
# `pnpm hooks:install` - run once after cloning. Safe to run again.
#
# Deliberately not a `prepare` script: that would run inside the Docker image builds, which have
# no git and no bash. A developer runs this by hand; CI enforces the same rules regardless.
set -eu

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

git config core.hooksPath .githooks
# The shared branch is pushed to directly; rebasing local work onto it on pull keeps its history
# a straight line instead of a "Merge branch ..." commit per developer per pull.
git config pull.rebase true
chmod +x .githooks/* scripts/check-commit-message.sh 2>/dev/null || true

echo "Hooks installed (core.hooksPath=.githooks, pull.rebase=true)."
echo "  commit-msg : conventional commit format"
echo "  pre-push   : no push to main, branch name, commit messages, typecheck + lint"
echo "Rules: CONTRIBUTING.md"
