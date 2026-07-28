# Rath Dev Mission — Pokemon CRM enrichment gate, no production import

You are running as the Rathworkspace platform developer profile from `~/rathworkspace`.

## Goal

Prepare the Pokemon lead-agent output for CRM import, but **do not import into the production Rathworkspace DB yet**. This is a human gate. The operator must approve enrichment quality before any production import.

## Hard rules

- Do **not** run a production DB import into `~/rathworkspace/data/rathworkspace.db`.
- Do **not** contact businesses, send emails, texts, calls, forms, or outreach.
- Do **not** mark any lead active.
- Do **not** merge or delete anything.
- Do **not** touch unrelated dirty files, especially `agents/pokemon-vending-outreach-sender/` if present.
- Keep output concise and useful for the operator.

## Context

The Pokemon CRM is live at `/pokemon-crm`. The forward source of truth is Rathworkspace SQLite, but legacy lead agent output still exists as CSV/XLSX staging files.

Important files:

- Repo: `~/rathworkspace`
- Lead agent wrapper: `~/rathworkspace/agents/pokemon-vending-lead-scout/scripts/pokemon_machines_profile_worker.sh`
- Lead agent prompt: `~/rathworkspace/agents/pokemon-vending-lead-scout/profile-worker-prompt.md`
- CRM import bridge: `~/rathworkspace/scripts/import-pokemon-pipeline-crm.ts`
- Legacy Pokemon lead CSV: `~/command-center/Pokemon Machines/pokemon vending/Pokemon_Vending_Lead_Pipeline.csv`
- Legacy active CSV: `~/command-center/Pokemon Machines/pokemon vending/Pokemon_Vending_Active_Leads.csv`
- Lead build script: `~/command-center/Pokemon Machines/scripts/pokemon_lead_system.py`

## Required work

1. Emit a `rathworkspace-platform-developer` started event.
2. Run the Pokemon lead refresh/enrichment **with production CRM sync disabled**:

```bash
cd ~/rathworkspace
POKEMON_CRM_DB_SYNC=0 agents/pokemon-vending-lead-scout/scripts/pokemon_machines_profile_worker.sh
```

3. Run a dry-run CRM import summary only:

```bash
cd ~/rathworkspace
npm run import-pokemon-pipeline-crm -- --dry-run "$HOME/command-center/Pokemon Machines/pokemon vending/Pokemon_Vending_Lead_Pipeline.csv"
```

4. Optionally test import into a temporary DB only, never production:

```bash
rm -f /tmp/pokemon-crm-enrichment-gate.db /tmp/pokemon-crm-enrichment-gate.db-wal /tmp/pokemon-crm-enrichment-gate.db-shm
RATHWORKSPACE_DB=/tmp/pokemon-crm-enrichment-gate.db npm run migrate
RATHWORKSPACE_DB=/tmp/pokemon-crm-enrichment-gate.db npm run import-pokemon-pipeline-crm -- "$HOME/command-center/Pokemon Machines/pokemon vending/Pokemon_Vending_Lead_Pipeline.csv"
```

5. Produce a gate report in:

`~/command-center/Pokemon Machines/CRM/enrichment_gate_report_2026-07-06.md`

The report should answer:

- How many leads are in the refreshed pipeline?
- How many have owner name candidates?
- How many have owner phone / public venue phone / no phone?
- How many have owner emails / public emails?
- How many are walk-in priority High / Med / Low?
- Top 20 leads by Pokemon-specific fit after dry-run/temp import.
- Which categories dominate?
- What enrichment gaps remain before import?
- Is the sheet good enough to import into CRM? Give verdict: `APPROVE_IMPORT`, `APPROVE_WITH_CAVEATS`, or `DO_NOT_IMPORT_YET`.

6. Emit a completed or blocked event.

## Final response

Reply only with:

- Report path
- Verdict
- Key counts
- Explicit statement that production DB import was not run
- Next command Hermes should run if the operator approves import
