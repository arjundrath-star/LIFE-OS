# Mini kickoff prompt for Claude Code / Ultra Code

Use this as the first message inside a Claude Code or Ultra Code tmux session running on the VPS.

```text
You are Claude Code running on Arjun Rath's the VPS provider VPS. Your mission is to implement rathworkspace named-agent orchestration and dashboard hooks.

Start here:
/home/Arjun/rathworkspace/CLAUDE_AGENT_ORCHESTRATION_PROMPT.md

Working directory:
/home/Arjun/rathworkspace

Follow the prompt exactly. Use the long-running harness pattern: create/update AGENT_ORCHESTRATION_PROGRESS.md and agent-orchestration-features.json early, explore first, write a plan, call Hermes for advisory feedback at the required checkpoints, then implement incrementally with verification. Do not weaken auth, do not expose secrets, and do not send any outreach emails to venue leads.

At the end, send the required completion email to operator@example.com from operator@example.com via gws, summarizing what agents were set up, dashboard surfaces changed, hooks/scripts created, verification results, and remaining work.

Begin by reading the mission prompt and repo state. Then write your plan to /home/Arjun/rathworkspace/.agent-orchestration/PLAN.md and run the first Hermes advisory checkpoint before editing production code.
```

Suggested tmux command from the VPS shell:

```bash
cd /home/Arjun/rathworkspace
tmux new-session -s rath-agent-orchestration
# then launch your Claude Code / Ultra Code command and paste the prompt above
```

If using Claude Code print/non-interactive mode, adapt to your installed command, for example:

```bash
cd /home/Arjun/rathworkspace
claude "$(cat /home/Arjun/rathworkspace/CLAUDE_AGENT_ORCHESTRATION_KICKOFF.md)"
```
