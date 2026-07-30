---
name: resume
description: Load the current build state and decide what to work on next. Run this at the start of every session, before reading any code. Use when the user says resume, continue, where were we, what's next, or starts a session with no other context.
disable-model-invocation: false
allowed-tools: Read Glob Grep
---

## Current state

**`docs/state/NOW.md` has already been injected into your context by the `SessionStart` hook.**
It carries the phase, the next task, what is blocked, and the landmines. Do **not** cat
`PROGRESS.md` or `SESSION-LOG.md` to orient yourself — that is the expensive habit this hook
exists to remove, and `SESSION-LOG.md` grows every session.

If the brief is missing (hook not yet reloaded — the user may need to open `/hooks` once), and
only then, fall back to `cat docs/state/NOW.md`.

```!
echo "--- git ---"
git log --oneline -5 2>/dev/null
echo "--- working tree ---"
git status --short 2>/dev/null | head -20
```

## Your task

You have just been handed a project mid-build. Orient yourself in this order and **do not read
anything else yet**:

1. The injected brief already names the current phase and the next task. Trust it — it was
   written by the session that did the work.
2. Open only that phase file (`plan/PHASE-NN-*.md`) and read that task's acceptance criteria.
3. If the phase file points at a reference doc, open **that one file** from `docs/reference/`.
4. The brief lists what is blocked. Open `docs/state/OPEN-QUESTIONS.md` only to read the specific
   OQ/G items it named — do not read the whole file.

Then report back in this shape, in under 15 lines:

```
Phase:      02 — Borrowing
Done:       reserve/release, IM approval endpoint
Next task:  2.4 return flow (partial returns)
Blocked by: nothing   (or: OQ-07, needs a decision from the user)
Plan:       <3–5 bullets of what you are about to do>
```

Then stop and wait for the user to confirm, unless the working tree is dirty with an obviously
half-finished task — in which case say so and propose finishing it first.

**Do not** start reading source files broadly, do not run a repo-wide grep, and do not open more
than two reference docs. If you need to find where something lives, delegate to the `explorer`
subagent so the search output never enters this context window.
