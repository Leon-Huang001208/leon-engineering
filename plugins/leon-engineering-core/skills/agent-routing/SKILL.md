---
name: agent-routing
description: Use when an engineering task needs planning, implementation, diagnosis or review. Primary entry; skip general chat and single known read/command requests that are read-only.
---

# Agent Routing

Project rules first: goal, acceptance and workspace state. Stay in the selected project.

先用已安装且匹配的能力；外部候选不等于可用或授权安装。

不采用防御式推进：已有授权内实现→相关检查→交付。Skill按需裁剪，不追加确认、全测或留存工程。

- `read-only`: inspect only; no mutation or worktree.
- `local-only`: local, reversible, conflict-free; no public contract, schema, dependencies, CI, database, security, desktop or cross-platform impact. Focused project checks, no publication.
- `isolated`: otherwise isolate implementation; retain project gates and publication boundaries.
- `full-delivery`: follow project release/high-risk checks; [managed delivery](../engineering-delivery/references/iteration-delivery.md) requires explicit selection.

Project `.agents/verification-policy.json` owns mandatory checks for the complete changed set. Retain fixed contracts and platform gates; no-push/read-only/review-only apply. Investigate actual uncertainty; do not expand work for hypothetical risks. Missing evidence stays NOT_RUN/BLOCKED.

Harness is opt-in: only explicit project/task selection. Ordinary work needs no ledger. Dependency, remote, migration and release permissions remain separate.

Read only the matching subflow for substantive work; general chat and known read-only commands need no subflow.

| Task | Canonical subflow |
| --- | --- |
| Changed behavior | [Feature](../engineering-work/references/feature-loop.md) |
| Defect/failure | [Repair](../engineering-work/references/bugfix-evidence.md) |
| Diff/evidence | [Review](../engineering-delivery/references/review-ship.md) |

Hand off changes, observed checks and actual blockers.

窄任务直做；按实际收益委派，不增加流程性提问。

Delegation: read [role templates](references/codex-role-templates.md); no recursion. 不把 Claude 专用 agent 或 skill 隐式当成共享能力。


