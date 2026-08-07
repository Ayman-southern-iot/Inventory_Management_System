# AI Playbook maintenance

**Goal:** keep `AI_PLAYBOOK.md` accurate so future sessions do not burn tokens re-deriving the
project from source. The playbook is the single, human-readable orientation document; treat it
like a slowly-changing summary of the rules, layout, commands, landmines and conventions.

## When you must update the playbook

Update `AI_PLAYBOOK.md` whenever any of the following changes. Section numbers refer to the
current playbook — keep them in sync if you renumber.

| Change | Edit section |
|---|---|
| A new module added/removed/renamed under `apps/api/src/modules/` | §6 Layout, §8 Backend conventions |
| A new top-level directory, app, or package added/renamed | §6 Layout |
| A new `plan/PHASE-*.md` added, or a phase is completed | (not here — lives in `docs/state/PROGRESS.md`; cross-link from §0 Build status if relevant) |
| A new root script added (`package.json`) or port changed | §7 Commands, ports, dev users |
| A new rule added/changed in `.claude/rules/` | §3 Non-negotiables, §8–§13 (backend/frontend/db/testing/infra) |
| A new skill or agent added under `.claude/skills/`, `.claude/agents/` | §15 Skills & agents |
| A landmine added/removed (also updated in `docs/state/NOW.md`) | §16 Landmines |
| A new open question or gap lands (also in `OPEN-QUESTIONS.md`) | §17 Open work & known gaps |
| A new ADR lands (also in `docs/adr/`) | §3 Non-negotiables if it touches a non-negotiable |
| A new convention established (naming, testing, structure) | §14 Conventions, §12 Testing, etc. |
| Settings/Config ownership changes | §11 Settings & config ownership |
| Domain model / state machine / role rules change | §5 The six concepts you must know |
| Screen map or notification matrix changes | §19 Screen map, §18 Notifications matrix |
| BOM generation rules change | §20 BOM generation rules |
| Capacity / deploy / runbook changes | §21 Capacity, deployment, runbook essentials |

## How to update

- **Edit only the changed sections.** Do not rewrite the whole file on every change.
- Keep it **dense, accurate, current**. The playbook is the orientation doc; verbose prose
  belongs in the section's dedicated reference (`docs/reference/05-user-flows.md` is the one
  file you should still open on demand — the rest is inlined here).
- If a rule **conflicts** with what is in `AI_PLAYBOOK.md`, the **playbook must be updated to
  match the canonical source** (the rule file, `CLAUDE.md`, `docs/reference/`, or the actual
  code). The playbook is a derivative summary — never a competing source of truth.
- Update the `Last updated:` date at the top when you change anything.
- If you renumber sections, also update the section references in this rule file.

## What is NOT in scope

- Do not duplicate `CLAUDE.md`, `docs/state/NOW.md`, `docs/state/PROGRESS.md`, or
  `docs/reference/*.md` — link to them.
- Do not move or rename files referenced from this playbook without updating the link here.
- Do not add phase-by-phase detail that already lives in `plan/PHASE-*.md`.
- Do not inline `docs/reference/05-user-flows.md` (the per-screen walkthrough) — it is the
  one reference file intentionally kept external because it changes with the UI and is only
  needed for the exact flow being built.

## Why this is here

Without this rule, the playbook rots the moment a phase lands and the next session burns
tokens re-reading `apps/api/src/modules/*`, `.claude/rules/*`, and `docs/state/*` to recover
context the playbook was supposed to carry. The cost of a 5-line edit to the playbook is
trivial; the cost of a 5,000-token re-orientation is recurring.

## Reminder mechanism

A `PostToolUse` hook (`.claude/hooks/playbook-reminder.sh`) prints a one-line reminder to
Claude after every `Write|Edit` on a playbook-relevant path. The reminder is **advisory**, not
blocking — it tells Claude to ask itself "did I just change something the playbook should
reflect?" before considering the edit complete. Claude decides; the hook does not.