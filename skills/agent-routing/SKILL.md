---
name: agent-routing
description: Route a coding task between the main session, one isolated read-only subagent, a worktree, or an opt-in agent team. Use when deciding delegation, parallelization, context isolation, or edit safety for an engineering task.
---

# Agent Routing

Use direct tools for a known file, narrow edit, known command, or short answer. Use one read-only subagent when exploration, logs, or search results would crowd the main context. Use a worktree for concurrent edits, risky work, or more than one implementation path. Request an agent team only after user approval of a file-partitioned task graph; never use teams for coupled edits.

State the route and why. Give editing agents a clean worktree, acceptance criteria, changed-file summary, and validation. Never give a subagent authority to spawn another agent.
