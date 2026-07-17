Work in ~/rathworkspace. Read, in order:
1. docs/plans/pokemon-ops/PROGRESS.md (current state)
2. docs/plans/pokemon-ops/phases/PHASE-2.md (your spec)
3. Only the sections of docs/plans/pokemon-ops/PLAN.md and SYSTEM_DISCOVERY.md your spec
   points you to. Do not load PROJECT_CONTEXT.md unless a decision's rationale is unclear.

Pre-flight: re-run the previous phase's DoD commands. If any fail, fix the regression or
halt with a PROGRESS.md entry. Never build on a broken base.

Build exactly to your spec's DoD. Rules: you may NOT edit PLAN.md or any phases/*.md
(spec problems go under "spec issues" in PROGRESS.md and you stop at the phase boundary);
PROGRESS.md is append-only below the current-state block; follow repo AGENTS.md
(agent-event lifecycle, never weaken the Google allowlist, additive migrations only);
external-process DB writes use IMMEDIATE transactions.

Finish with the handoff ritual: all DoD green with outputs pasted into PROGRESS.md →
commit + push → annotated tag pokemon-ops/phase-2 → update the PROGRESS.md current-state
block → agent-event complete.
