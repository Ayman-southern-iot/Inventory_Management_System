# Build plan

Seven phases. **One phase per session.** Each has tasks with acceptance criteria and exit criteria
that `/verify` checks.

| Phase | Ships | Independently useful? |
|---|---|---|
| 00 | Repo, config, auth, users, roles, admin panel | no |
| 01 | Catalogue, locations, placements, ledger, IM inventory screens | yes — a working stock register |
| 02 | Borrowing loop end to end | yes — people can start using it |
| 03 | Requisitions, approvals, tracker, notifications | yes |
| 04 | BOM generation and letterhead PDF | yes |
| 05 | Funds, purchases, receive-to-stock | closes the loop |
| 06 | Exports, audit UI, monitoring, backup drill | hardening |

Phases 01 and 02 are shippable on their own. Get them into real use early — a week of the IM
actually moving stock will surface more than another week of design.

## Rules for working a phase

1. Tasks are ordered. Some have hidden dependencies; do not reorder without saying why.
2. A task is done when its acceptance criteria are demonstrably met — not when the code is written.
3. Tick the checkbox, update `docs/state/PROGRESS.md`, commit, then move on.
4. At the end: `/verify NN`, then `/handoff`, then stop.
5. Anything not specified goes to `docs/state/OPEN-QUESTIONS.md`. Never invent a requirement.
