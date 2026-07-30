# Pilot checks

1. Start Claude Code in a disposable Git repository with `--plugin-dir /Users/leon/Developer/claude-engineering`.
2. Confirm `/leon-engineering:agent-routing` and `/leon-engineering:skill-health` are listed and runnable.
3. Confirm `repo-explorer` and `planner` appear in `/agents`, cannot write, and cannot spawn another agent.
4. Confirm `git status` is allowed, `.env` write is denied, `git push` is asked, dependency installation is asked, and a routine file edit is allowed.
