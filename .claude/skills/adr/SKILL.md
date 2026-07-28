---
name: adr
description: Record an architecture decision that is expensive to reverse. Use when choosing between technologies, changing a core pattern, or making a call a future engineer would otherwise re-open.
argument-hint: "[decision title]"
---

Write an ADR for: **$ARGUMENTS**

Create `docs/adr/NNNN-<kebab-title>.md`, numbering one higher than the highest existing file.

```md
# NNNN — <Title>

- **Status:** Accepted
- **Date:** <YYYY-MM-DD>
- **Supersedes:** <ADR number, or none>

## Context
What forced a decision. The constraints that were actually binding — not a general essay.

## Options considered
| Option | Pros | Cons |
|---|---|---|
Two or three real options. If there was only ever one option, this doesn't need an ADR.

## Decision
What we are doing, stated in one sentence, in the present tense.

## Consequences
What becomes easy. What becomes hard. What we are now committed to.
**What would make us revisit this** — be specific: a number, a scale, a requirement change.
```

Keep it under a page. An ADR nobody reads is worse than no ADR. Then add a one-line pointer in
`docs/state/DECISIONS.md` so the decision is discoverable without opening the folder.
