---
name: handoff
description: Write the session's state to disk so the next session starts cold with nothing lost. Run at the end of every working session, before /clear or /compact, and whenever context is getting full.
disable-model-invocation: false
argument-hint: "[optional note]"
---

```!
echo "--- changed files ---"; git status --short 2>/dev/null | head -40
echo "--- commits this session ---"; git log --oneline -10 2>/dev/null
```

## Your task

Persist what only you currently know. Assume you are about to be deleted and a competent stranger
takes over tomorrow with none of this context.

**1. Update `docs/state/PROGRESS.md`**
- Tick completed tasks. Tick nothing you did not verify.
- Update the "Current position" block at the top: phase, next task, and one line on the state of
  the working tree.

**2. Append to `docs/state/SESSION-LOG.md`** — newest entry at the top, this format:

```md
## <ISO date> — Phase NN
**Did:** <2–4 bullets, concrete: what now works that didn't before>
**Decisions:** <anything you chose that wasn't specified; also add to DECISIONS.md>
**Landmines:** <anything half-done, any test skipped, any shortcut taken — be blunt>
**Next:** <the single next action, specific enough to start without thinking>
```

**3. Update `docs/state/DECISIONS.md`** for anything you decided that a future reader would
otherwise re-litigate. One line of reasoning each. If the decision is architectural and expensive
to reverse, write an ADR instead with `/adr`.

**4. Update `docs/state/OPEN-QUESTIONS.md`** — add anything you had to guess at, mark anything the
user answered as resolved with the answer inline.

**5. Commit.** Conventional commit message summarising the session's work.

Then tell the user, in three lines: what shipped, what is half-done, and the exact next step.
Suggest they `/clear` before the next session — a fresh window plus this state file beats a
degraded window every time.

$ARGUMENTS
