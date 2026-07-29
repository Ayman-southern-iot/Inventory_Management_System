# Phase 03 — Requisitions and approvals

**Goal:** the procurement workflow. The largest phase — expect it to span more than one session,
and use `/handoff` at each natural break rather than pushing through a degraded context.

**Reference:** `docs/reference/05-user-flows.md` §5.2–5.4, `docs/reference/08-notifications.md`,
`docs/reference/02-assumptions.md`

**Blocked by:** OQ-01 and OQ-02 must be answered before task 3.4.

## Tasks

- [x] **3.1 Schema** — `requisitions` (with `requested_amount`, `approved_amount`,
      `required_approver_count`, `threshold_at_submit`), `requisition_items`,
      `requisition_approvals`, `requisition_events`.
      *Accept:* `UNIQUE (requisition_id, stage, slot)` on approvals; events are append-only.

- [ ] **3.2 Requisition form** — two zones exactly as requirements §3 scopes them: per-request
      header (department, project, urgency, approval deadline, reason) and per-line items
      (name, quantity, unit amount). Combobox over the catalogue with a free-text escape hatch.
      *Accept:* the green in-stock hint is advisory and never blocks adding an item.

- [x] **3.3 Submit** — freezes `requested_amount`, reads the threshold, writes
      `required_approver_count`, seeds approval rows, emits `REQUISITION_SUBMITTED`.
      *Accept:* changing the threshold afterwards does not alter an in-flight requisition. Test this
      explicitly — it is the assumption most likely to be broken by a later change.

- [x] **3.4 Approval engine** — IM first, then approvers in parallel; any single rejection is
      terminal; approval revises `approved_amount` if `allow_amount_revision` is on; withdraw
      allowed until BOM generation; approvers see who else has not responded yet.
      *Accept:* every transition in `docs/reference/05-user-flows.md` §5.2 has a test, and every
      illegal transition is rejected.

- [x] **3.5 Delegation** — an approver toggles a delegate for a date range; the item appears in the
      delegate's queue; the audit records "approved by X on behalf of Y".
      *Accept:* an expired delegation does not grant access.

- [ ] **3.6 Live tracker** — nine nodes driven off `requisition_events`, not off the status column.
      Green ✓ / ash ○ / red ✗ / amber ◐ partial / grey ⊘ skipped. "See why" reveals the rejection
      note with the rejector's name and designation.
      *Accept:* the tracker is correct for a requisition that was approved, withdrawn, and
      re-approved.

- [ ] **3.7 Approver portal** — Pending Approvals with a live badge count, Accepted Approvals with
      status labels, newest first, tracker on click.
      *Accept:* the badge count updates over the websocket without a refresh.

- [ ] **3.8 IM requisition screens** — Pending Approvals with badge, Accepted Approvals list showing
      the current stage per row.
      *Accept:* the list orders by most recent activity, not creation date.

- [ ] **3.9 Notifications and the deadline job** — cron every 15 minutes finds approvals still
      pending past `approval_deadline` and reminds, repeating every 24h until acted on.
      *Accept:* a requisition whose deadline passes while nobody is logged in still generates the
      reminder.

## Exit criteria

- Full path works: submit → IM approve → both approvers → APPROVED
- Rejection at each stage behaves correctly and notifies the requester with a readable note
- Withdraw returns the requisition to the right state and notifies everyone affected
- Self-approval is handled per OQ-07
- Threshold-freeze test passes
