# PHASE 8 (STRETCH) — SQS transaction stream

PRECONDITION: the operator has created the AWS account + SQS queue + IAM keys and validated them
in Nayax Core (Administration → Operator → Transactions Report tab), with roles
Transaction Dispatcher + Transactions Report Subscriber. Halt with a PROGRESS.md entry
if absent. Note: no historical backfill — only transactions after enablement.

Goal: near-real-time sales via SQS receive; Lynx polling demoted to hourly reconciliation.

Context: a scheduler tick doing short ReceiveMessage batches — outbound HTTPS,
pull-based like every other integration; NO resident consumer daemon on this small box.

Work: receive tick parsing transaction JSON → pk_sales source='sqs' (same dedupe key
space as lynx via external_txn_id; a transaction seen by both must land once — decide
and test the precedence); demote tickNayax lastSales to hourly reconciliation; fixture
tests from recorded messages.

DoD:
- fixture-message tests → 0; verify:pokemon-ops → 0
- one live vend (or Nayax test transaction) ingested end-to-end via SQS (paste the row)
- duplicate delivery test → single row
- tickNayax interval change verified in scheduler; tag `pokemon-ops/phase-8` pushed
