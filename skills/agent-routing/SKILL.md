---
name: agent-routing
description: Route a coding task between the main session, one isolated read-only subagent, a worktree, or an opt-in agent team. Use when deciding delegation, parallelization, context isolation, or edit safety for an engineering task.
---

# Agent Routing

已知文件、窄范围改动或明确命令默认由主会话直接完成；不得为了流程而向用户提问；不得仅因可用就创建计划、代理或 worktree。只有在只读探索能减少主会话等待或上下文拥塞，或并行编辑有明确速度收益时才派发代理，并且须在派发前说明预期收益和边界。风险或耦合需要隔离时必须升级，必要时使用 worktree；该条件不以速度收益为前提。

State the route and why. Give editing agents a clean worktree, acceptance criteria, changed-file summary, and validation. Never give a subagent authority to spawn another agent.

## Cross-project adapter

Route only after identifying the target project and its local rules, verified commands, platform constraints, and current worktree state. Global defaults are a fallback, not permission to inspect or alter other projects. Keep one project profile per task; do not merge project-specific conclusions into shared policy without an explicit, separately reviewed promotion.

## Codex delegation

When using Codex subagents, read `references/codex-role-templates.md` and use exactly one role template. The prompt must name the role, scope, boundary, acceptance criteria, and evidence format. Verify the Git diff after a read-only role and the parent checkout after an implementer role.
