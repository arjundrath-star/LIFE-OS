# Claude Code instructions for rathworkspace

Read `AGENTS.md` first. It is the canonical agent operating manual for this repo.

For platform software work, also read:

```text
agents/rathworkspace-platform-developer/AGENTS.md
```

Hermes is the orchestrator. Claude Code / Ultra Code build sessions are specialist worker sessions and should report to `/agents` as `rathworkspace-platform-developer` using `npm run agent-event -- ...`.

Do not weaken auth, expose secrets, or make `/api`, `/ws`, `/terminal`, or `/files` public. Run `npm run build` before claiming software changes work.
