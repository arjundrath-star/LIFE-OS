#!/bin/bash
# RATHWORKSPACE dashboard build launcher
cd /home/Arjun/rathworkspace || exit 1
exec tmux new -s build "claude --dangerously-skip-permissions 'Read and execute /home/Arjun/.openclaw/workspace/deliverables/rathworkspace-dashboard/BUILD-PROMPT.md'"
