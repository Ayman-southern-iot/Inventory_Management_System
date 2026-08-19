# Handoff format — output reviewed by the assisting engineer

Your output is copied out of this terminal and pasted to a second engineer (**Zai**), who has
**no shell, no git, no database, no browser** — only the characters you print. A summary is
unreviewable; a paraphrased test result is unverifiable.

**Every claim carries its evidence in the paste. If it is not in the block, it did not happen.**

This file is always loaded, so it is kept terse. **The copy-paste template and a worked example
live in `ASSIST.md` §12** — open that when you need the full shape.

## The block

One block per issue. Never batch two issues into one block. These labels, this order, no prose
above or below.

```
TASK       QA-### or a one-line description.
CLASSIFY   FIXED | NOT-REPRODUCED | WORKING-AS-DESIGNED | BLOCKED | INVESTIGATION-ONLY
SPEC       What the behaviour rests on. Exactly one of:
           REQUIRED §n        — the requirements document mandates it. Cite the section AND
                                the docs/reference file that transcribes it (see below).
           DERIVED A-n/G-n/OQ-n — a recorded decision filled a gap the document left open.
           NO-BASIS           — neither. The document is silent, no decision is recorded.
                                Not automatically wrong, but never fixed without the lead.
ROOT       The mechanism — why this input produced this wrong output. 2–3 sentences.
TOUCHED    Every path with line ranges. Mark (new) / (deleted). "none" if investigation only.
DIFF       Real unified diff.
EVIDENCE   Verbatim command + output, or a pointer to this session's GATE block.
BASELINE   N pass / M fail — baseline N₀/M₀ — same M / different (list which).
INVARIANT  Which ASSIST §5 / playbook §3 invariants the change comes near, and how each is
           preserved. Write "none" explicitly — never omit the label.
NEWSURF    New-surface declaration (list below). "none" if none.
NOTCHECKED Mandatory. Never empty.
OPEN       Assumptions made, OQ-* added, decisions wanted.
```

## Which document wins

In descending authority:

1. **`docs/reference/_source/requirements-verbatim.md`** — the customer's requirements document,
   transcribed into the repo so both engineers can cite it. Eleven sections, and it is *thin*:
   most of what this system does is an elaboration of it, not a statement in it. **Cite
   `REQUIRED §n` against this file.** Only the text above its `END OF TRANSCRIPTION` marker
   carries authority; the reader's notes below it are project analysis.
   *It is a markdown conversion, not the docx.* If a question turns on the literal wording of a
   clause — a comma, a "should" vs "must", anything in tracked changes — that is an escalation to
   the lead to verify against the original, and the corrections log at the bottom of that file
   records the outcome.
2. **`docs/reference/*.md`** — the design elaboration, and the `A1`–`A13` assumptions register in
   `02-assumptions.md`, each carrying its own `requirements §n` citation.
3. **The recorded decisions** — playbook §1.5 (`G1`–`G10`), `docs/state/DECISIONS.md`,
   `docs/state/OPEN-QUESTIONS.md` (`OQ-*`, `G-*`). A gap answered here is as binding as the
   document.
4. **The code**, where it disagrees with the playbook — the playbook is a derivative summary and
   is currently known to be drifted (ASSIST §13).
5. **`AI_PLAYBOOK.md` / `PROJECT-MAP.md` / `docs/state/NOW.md`** — orientation only. **Never cite
   these as the reason a behaviour is correct.**

Sections cited across this repo: `requirements §3, §4, §5, §6, §9, §10, §11`. A claim of
`REQUIRED §n` for a section nobody has ever cited deserves a second look.

**The trap this ordering exists to prevent:** large parts of this build have no line in the
requirements document — the whole borrow/reserve/quarantine loop, self-approval substitution,
transportation cost, send-back-for-revision, funding snapshots, most of the notification matrix.
That does not make them bugs; it makes them `DERIVED` or `NO-BASIS`. Do not "correct" the build
toward a literal reading of a thin document, and do not treat playbook prose as a requirement.
Classify, then ask.

## DIFF

- A real `git diff` with ≥3 lines of context. Prose describing a change is not reviewable.
- **No `...` inside a hunk, ever.** Do not hand-trim.
- Over ~400 lines total: full hunks for files where logic changed, then
  `path — +N/-M — one line` for the rest, and say you truncated.
- **Never truncated, regardless of size:** migrations, `config.schema.ts`, `error-code.ts`,
  `i18n/en.ts`, `tokens.css`, anything under `modules/stock/`.

## EVIDENCE

- **Verbatim.** The command, then its output, copy-pasted. Counts exactly as printed. Never
  "should pass" / "presumably green" — if you did not run it, it goes in NOTCHECKED.
- **Tag every line `R` (I ran this) or `D` (I deduced this).** Never blend them in one sentence.
- **The new-behaviour test is shown failing first**, then passing. A fix with only a green run is
  hoped, not verified.
- **The full gate runs once per session or per logical batch**, printed once as a `GATE` block;
  each issue block then carries only the targeted spec for its area and points at that GATE.
  Re-running `typecheck` + `lint` + `test` per issue is what makes this protocol get abandoned.
  The gate must be re-run after the last edit of the batch, and that output is what counts.
  **Two exceptions, because a batch gate cannot attribute a regression:**
  - If the batch GATE shows **any delta from baseline** — a new failure, or one of the known
    failures changing shape — **bisect the batch before anything ships.** A regression from fix
    #3 masked or shifted by fix #7 is otherwise unattributable.
  - Any block whose `INVARIANT` is non-empty, or whose `NEWSURF` names stock, a migration, or an
    `ErrorCode`, **gets its own gate** rather than riding the batch. That is a small number of
    blocks, and they are the ones where attribution is worth the runtime.
  ```
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts <pattern>   # NOT `test:int -- <spec>`: that runs all 39 files
  bash .claude/hooks/guard-hardcoding.sh --scan-all   # if you added any literal
  ```
- Integration suite: redirect, do not stream (it has blown a 600s timeout on a cold DB).
  `pnpm --filter @ims/api test:int > /tmp/int.log 2>&1; tail -40 /tmp/int.log`, plus
  `grep -nE "FAIL|✗|failed" /tmp/int.log`.
- UI bug evidence is the **actual request and response** from the Network tab, not a described
  screenshot. More than once the request never left the browser.

## BASELINE

The integration suite is **not fully green**, and the current documented figure lives in
`docs/state/DECISIONS.md` — read it there, do not trust a number memorised from a rule file.

- Capture the baseline **before your first edit of the session** and keep the file.
- Report `N pass / M fail — baseline N₀/M₀ — same M` or `— different: <list>`.
- **Never write "tests pass" while any are red.**
- Never `.skip`, delete, or rewrite a failing test to get green — that is a STOP.

## NEWSURF — declare any of these, with the file that holds it

Each one silently breaks the SPA, the audit trail, or the physical shelf:

- a new `ErrorCode` member — **and** its copy entry, because the SPA selects text by `code`
- a new key in `apps/web/src/i18n/en.ts`
- a new migration, or any schema change
- a new `app_settings` key or changed default
- a new key in `apps/api/src/config/config.schema.ts`
- any write to `stock_placements` / `stock_ledger`, or a new call into `StockService`
- any read or write of an approval or funding snapshot
- a new cron job or scheduled task
- a new or changed upload path
- a new dependency

## STOP — print the STOP block and nothing else

Print `STOP-INVARIANT`, name the invariant, wait. Do not implement, do not work around, do not
open a second approach.

- A write to `stock_placements` / `stock_ledger` outside `StockService`
- A schema change or new migration
- An applied migration edited, a column dropped, or a column renamed in place
- An append-only trigger removed, or a cascade over `stock_ledger` / `requisition_events` /
  `audit_log`
- A failing test deleted, skipped, or rewritten
- **`NO-BASIS` + establishing or changing a behaviour rule.** The test: *would the fix change
  what the system decides, or only stop it doing something it never intended to do?* Changing a
  decision is a STOP. Fixing a crash, a validation gap, an internal inconsistency, or a violated
  constraint **in already-shipped surface** is not — proceed and mark
  `SPEC: NO-BASIS (defect in shipped surface)`, so the lead sees it without having to unblock it.
  Much of this build is `NO-BASIS` (transportation cost, unverify-purchase,
  send-back-for-revision, most of the notification matrix); a blanket STOP would stall every QA
  round on shipped code.
- Anything touching auth, roles, permissions, or file upload
- An `app_settings` value or config default changed
- `process.env` read outside `config.schema.ts`
- `consistent-type-imports` re-enabled for `apps/api/src`

## Classification specifics

- **NOT-REPRODUCED** needs the exact attempt: request, persona, response, and the state you set
  up. "Could not reproduce" alone is not a result.
- **WORKING-AS-DESIGNED** needs a citation under the authority order above. Correct behaviour
  that gets reported as a bug: conditional-update claiming, frozen approver counts,
  `SELF_APPROVAL_NO_SUBSTITUTE`, IPv6-only dev server, `127.0.0.1:5173` refusing, no IM ping when
  the balance arrives, a self-tripped login rate limit. Do not "fix" these.
- **INVESTIGATION-ONLY** — the answer, the `file:line` refs, and **a 1–5 line verbatim excerpt
  per reference**. Zai cannot open the file; a bare `file:line` is unreviewable to them. Still do
  not dump whole files. `TOUCHED: none`.
- **Before writing code:** check ASSIST §8 and `docs/state/DECISIONS.md` for the feature name,
  and read the comment above any line that looks wrong — most surprising code here has a
  paragraph explaining which bug it prevents.
- **First rule out stale state** (ASSIST §7 step 0): Docker down, a stale API process serving old
  code (`apps/api/dist/src/main.js` mtime vs process start), a hand-edited dev setting.

## What comes back

Zai returns one of `AGREE` / `CHALLENGE <label> — <reason>` / `NEED <what>` per block. A
CHALLENGE is answered on the technical merits, once — verify it rather than complying
reflexively, and say so if it is wrong. Reaffirmed either way, the lead decides.

## Prose

- Lead with the finding. No preamble, no restating the request.
- Do not claim done. Report what is true; the lead decides whether it is done.
- Disagree once, in one sentence, with the technical reason. If reaffirmed, comply and note the
  concern. Do not re-litigate.
- Do not write to `docs/state/*` unless asked. Do not commit or push unless asked — if you
  committed, paste the SHA and the message.
- Never paste a secret, token, or password **value**. Name the key.
