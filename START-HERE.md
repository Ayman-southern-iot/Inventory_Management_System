# Start here

## 0. Before the first session — answer four questions

These four are in `docs/state/OPEN-QUESTIONS.md` and cannot be inferred from the requirements.
Edit that file and fill in your answers. Phases 00 and 01 can proceed without them; Phase 03 cannot.

1. **Below the 15,000 BDT threshold, how many approvers?** (assumed: 1)
2. **Are Approver 1 and 2 fixed company-wide, or per department?** (assumed: global with override)
3. **Do laptops need serial-number tracking?** (assumed: no — quantity only)
4. **What should the IM's ✎ Edit on an approved borrow do once the item has left the building?**

Also drop your company letterhead into `docs/` as a PDF or high-resolution PNG when you have it.

## 1. Set up

```bash
git init && git add -A && git commit -m "chore: project scaffold and build plan"
cd infra && cp .env.example .env    # fill in real values
```

## 2. Build it

Open Claude Code in the project root and run these, one session at a time:

```
/resume                 # orients itself, tells you where the build is
/build 00               # foundation
```

When it finishes a phase it will run `/verify`, then `/handoff`, then stop. Then:

```
/clear                  # fresh context window
/resume
/build 01
```

Repeat through Phase 06.

## 3. Be honest with yourself about "one shot"

This system is seven phases and a few hundred files. No single Claude Code invocation builds it in
one pass — not because the model can't write the code, but because the context window fills, and a
session working from a degraded window produces work that later sessions have to undo.

What this scaffold gives you instead is better than one shot: **every session starts as good as the
first one.** The state files mean a fresh window loses nothing, so you get seven strong sessions
rather than one strong session followed by six mediocre ones.

Realistically: Phase 00 and 01 are a session each. Phase 02 is one. Phase 03 is two or three.
Phases 04–06 are one each. Call it eight to ten sessions.

If you want to push it: `claude --dangerously-skip-permissions` with `/build` will run a phase
mostly unattended. Read the diff before you trust it, especially anything in `StockService`.

## 4. Things worth knowing

- **When a session feels dumb, it is.** Run `/handoff`, `/clear`, `/resume`. Do not push through.
- **`/context` and `/doctor`** tell you what is eating the window.
- **Never let it invent a requirement.** If it guesses, that guess becomes load-bearing three
  phases later. `docs/state/OPEN-QUESTIONS.md` exists so guesses are visible.
- **Review the stock code yourself.** It is the one part of this system where a bug is permanent.
