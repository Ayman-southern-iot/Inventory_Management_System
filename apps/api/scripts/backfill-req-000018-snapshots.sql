-- One-shot backfill of funding_snapshots for REQ-000018.
-- The hooks on FundsRepository and RequisitionsService are now live, but this requisition
-- completed its lifecycle before they were wired up, so the rows have to be reconstructed
-- from the existing events + sums. Each row is anchored to the event that triggered the
-- stage transition so the pills render in chronological order.

BEGIN;

INSERT INTO funding_snapshots (requisition_id, status, requested_amount, approved_amount, transportation, funded, spent, returned_to_accounts, unspent, snapshotted_at) VALUES
  -- SUBMITTED -> IM_REVIEW: requested_amount frozen at 4178, approved mirrors requested.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'IM_REVIEW',          4178.00, 4178.00, 34.00,    0.00,    0.00,    0.00,    0.00, '2026-08-10 23:48:49.399035+06'),
  -- IM_APPROVED -> AWAITING_APPROVAL: IM does not revise; approved mirrors requested.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'AWAITING_APPROVAL',  4178.00, 4178.00, 34.00,    0.00,    0.00,    0.00,    0.00, '2026-08-11 00:28:23.301933+06'),
  -- FULLY_APPROVED -> APPROVED: approver revised down to 3000 (event 30 AMOUNT_REVISED).
  -- This is the canonical "approved amount" the pill selector shows at the APPROVED stage.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'APPROVED',           4178.00, 3000.00, 34.00,    0.00,    0.00,    0.00,    0.00, '2026-08-11 00:30:45.292216+06'),
  -- BOM_GENERATED: no money moved yet; approved stays at the revised 3000.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'BOM_GENERATED',      4178.00, 3000.00, 34.00,    0.00,    0.00,    0.00,    0.00, '2026-08-11 00:42:43.189165+06'),
  -- SENT_TO_ACCOUNTS: still no money released.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'SENT_TO_ACCOUNTS',   4178.00, 3000.00, 34.00,    0.00,    0.00,    0.00,    0.00, '2026-08-11 00:48:42.294465+06'),
  -- FUNDS_RECEIVED: receipt of 3000 lands; now funded == approved.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'FUNDS_RECEIVED',     4178.00, 3000.00, 34.00, 3000.00,    0.00,    0.00, 2966.00, '2026-08-11 00:49:30.018886+06'),
  -- PURCHASED: spent 500 across two lines; unspent = 3000 - 500 - 34 - 0 = 2466.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'PURCHASED',          4178.00, 3000.00, 34.00, 3000.00,  500.00,    0.00, 2466.00, '2026-08-11 00:50:48.994312+06'),
  -- PURCHASE_VERIFIED: 2466 returned to Accounts in the same call; unspent = max(0, 3000 - 500 - 34 - 2466) = 0.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'PURCHASE_VERIFIED',  4178.00, 3000.00, 34.00, 3000.00,  500.00, 2466.00,    0.00, '2026-08-11 00:51:17.101502+06'),
  -- STOCKED: figures identical to PURCHASE_VERIFIED.
  ('91597307-81a8-4ed6-b0f3-57f906712c9d', 'STOCKED',            4178.00, 3000.00, 34.00, 3000.00,  500.00, 2466.00,    0.00, '2026-08-11 00:53:40.051337+06');

COMMIT;
