# Inventory Management System

Internal procurement, approval and inventory tool. Built with Claude Code against a written
specification, in phases, with state that survives context loss.

**If you are a human:** start at `START-HERE.md`.
**If you are Claude Code:** start with `/resume`. `CLAUDE.md` has your operating rules.

## Layout

```
CLAUDE.md              Operating rules. Loaded every session. Kept short deliberately.
START-HERE.md          What to type, in order.
.claude/
  settings.json        Permissions and hooks
  rules/               Coding standards. Path-scoped ones load only when relevant.
  skills/              Procedures: /resume, /build, /verify, /handoff, /add-endpoint, ...
  agents/              Specialists that work in their own context and return summaries
  hooks/               The no-hardcoding guard
docs/
  reference/           The full design, split by topic. Read one file, not the folder.
  adr/                 Decisions expensive to reverse
  state/               PROGRESS · SESSION-LOG · DECISIONS · OPEN-QUESTIONS  ← the memory
plan/                  PHASE-00 … PHASE-06, each with tasks and exit criteria
infra/                 docker-compose, Caddyfile, deploy/backup/restore scripts
apps/ packages/        Created during Phase 00
```

## The one idea behind this layout

A long Claude Code session degrades — instructions drift out of the window and quality drops. The
fix is not a bigger prompt. The fix is that **nothing important lives only in the context window**.

- What is done and what is next lives in `docs/state/PROGRESS.md`
- Why something was decided lives in `docs/state/DECISIONS.md`
- What was never decided lives in `docs/state/OPEN-QUESTIONS.md`
- What happened last session lives in `docs/state/SESSION-LOG.md`

So a fresh session reads about forty lines and knows exactly where it stands. `/resume` loads that
state; `/handoff` writes it back. Everything else — path-scoped rules that load only for the files
being touched, subagents that keep search output out of the main thread, one phase per session — is
in service of the same goal.

## Deploying

See `infra/` and `docs/reference/14-deployment.md`. Update loop is `cd /opt/ims && ./deploy.sh`.
Data lives in named volumes and survives every deploy; the ways it does not are listed in
`.claude/rules/60-infra.md`.
