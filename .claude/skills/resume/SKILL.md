---
name: resume
description: Load the current build state and decide what to work on next. Run this at the start of every session, before reading any code. Use when the user says resume, continue, where were we, what's next, or starts a session with no other context.
disable-model-invocation: false
allowed-tools: Read Glob Grep
---

## Current state

```!
cat docs/state/PROGRESS.md 2>/dev/null || echo "PROGRESS.md missing — this is a fresh repo."
```

```!
echo "--- last 3 session entries ---"
tail -n 40 docs/state/SESSION-LOG.md 2>/dev/null || echo "(no session log yet)"
```

```!
echo "--- git ---"
git log --oneline -8 2>/dev/null
echo "--- working tree ---"
git status --short 2>/dev/null | head -20
```

## Your task

You have just been handed a project mid-build. Orient yourself in this order and **do not read
anything else yet**:

1. From the state above, identify the **current phase** and the **first unchecked task** in it.
2. Open only that phase file (`plan/PHASE-NN-*.md`) and read the task's acceptance criteria.
3. If the phase file points at a reference doc, open **that one file** from `docs/reference/`.
4. Check `docs/state/OPEN-QUESTIONS.md` for anything blocking that specific task.

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
