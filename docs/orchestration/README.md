# Orchestration missions

These are the actual working artifacts used to drive long-running, multi-agent build
missions against this repo. Nothing here is a writeup after the fact: the prompts were fed
to the coding agents, the gates were checked during the runs, and the progress log was
written by the agent as it worked.

## Files

| File | What it is |
|------|------------|
| `build-mission-prompt.md` | The full mission prompt for the agent-orchestration build: scope, target architecture, DB schema guidance, safety constraints, verification checklist, and two mandatory mid-run advisory checkpoints. |
| `build-mission-kickoff.md` | The short bootstrap message pasted into a fresh agent session. It points at the mission prompt and restates the non-negotiables (no auth weakening, no secret exposure, no outbound email to leads). |
| `build-mission-progress.md` | The agent's own progress log: state, decisions, files changed, commands run with results, and the findings from an adversarial review pass that were fixed and re-verified. |
| `plan.md` | The implementation plan the agent wrote after exploration and before coding, including the feedback from advisory checkpoint 1 folded back in. |
| `feature-acceptance-gates.json` | The feature checklist as JSON. Each feature carries explicit acceptance criteria; `passes` flips from false to true only on verified command output, and criteria may not be weakened to make a run look done. |
| `redesign-prompt.md` | The mission prompt for the v2 UI restructure (routed app shell, nav rail, section pages) with hard no-regression constraints. |

## What to notice about the method

- Acceptance is objective. Every feature has concrete gates ("returns 401 without an
  allowlisted session", "second migrate run is a no-op"), and completion claims require
  real command output, not "looks done".
- Verification is layered: migrations run twice for idempotency, CLI negatives must exit
  non-zero, auth is probed with minted JWTs (401/401/200), and the UI is screenshot-proven.
- Progress is a durable artifact. The progress file and gate JSON live on disk so a later
  session can resume from state, not from memory.
- The build agent is itself a registered agent: platform work reports its own run events
  into the dashboard it builds, through the same event CLI as every other agent.
- Two advisory checkpoints (after plan, before completion) get a second model's review of
  safety gates and verification gaps, capped at two calls to prevent recursion.
