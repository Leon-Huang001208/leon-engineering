---
name: agent-routing
description: Route a coding task between the main session, one isolated read-only subagent, a worktree, or an opt-in agent team. Use when deciding delegation, parallelization, context isolation, or edit safety for an engineering task.
---

# Agent Routing

先检查当前已安装目录中的 skill、agent 和工具能否直接匹配任务；命中则按其触发条件使用，未命中才选择通用直做、只读调研、隔离 worktree 或代理。此检查属于快路径，不能把未检查可用能力合理化为直接执行；发现外部候选也不等于安装，安装仍须来源/权限审查和用户明确同意。

已知文件、窄范围改动或明确命令默认由主会话直接完成；不得为了流程而向用户提问；不得仅因可用就创建计划、代理或 worktree。只有在只读探索能减少主会话等待或上下文拥塞，或并行编辑有明确速度收益时才派发代理，并且须在派发前说明预期收益和边界。风险或耦合需要隔离时必须升级，必要时使用 worktree；该条件不以速度收益为前提。

## 主动框架学习

执行错误、用户纠正或新证据若可跨项目复用，主动提炼为候选规则，不等待用户再次指出。只要有实际证据且不改变权限、秘密、依赖、远程、发布、迁移、CI/CD、系统配置或破坏性边界，自动更新受管源、回归测试、安装副本和学习记录；高风险或影响面不明时请求明确确认。不得把项目特定事实提升为全局规则。

State the route and why. Give editing agents a clean worktree, acceptance criteria, changed-file summary, and validation. Never give a subagent authority to spawn another agent.

## Cross-project adapter

Route only after identifying the target project and its local rules, verified commands, platform constraints, and current worktree state. Global defaults are a fallback, not permission to inspect or alter other projects. Keep one project profile per task; do not merge project-specific conclusions into shared policy without an explicit, separately reviewed promotion.

## Codex delegation

When using Codex subagents, read `references/codex-role-templates.md` and use exactly one role template. The prompt must name the role, scope, boundary, acceptance criteria, and evidence format. Verify the Git diff after a read-only role and the parent checkout after an implementer role.
