# leon-engineering 文档索引

## 当前入口

- [项目入口](../README.md)
- [现行架构](ARCHITECTURE.md)
- [开发地图](DEVELOPMENT_MAP.md)

日期审计记录观察时点及后续事项，不是另一份运行规则。下列日期文档、历史设计、计划和试点结果保留为决策与证据，不自动代表当前运行方式；现行命令仍以对应模块文档、脚本帮助和测试合同为准。

## 历史设计、计划与证据

- [2026-09-30 Codex Hook 协议与来源审计](2026-09-30-codex-hook-compat-audit.md)
- [2026-09-30 职责收敛审计与处置](2026-09-30-role-convergence-audit.md)
- [2026-09-29 现状、差异与迁移基线](2026-09-29-engineering-foundation-governance-audit.md)
- [工程底座治理设计](superpowers/specs/2026-09-29-engineering-foundation-governance-design.md)
- [分阶段实施计划](superpowers/plans/2026-09-29-engineering-foundation-governance.md)
- [Codex–Claude 共享适配器设计](2026-07-31-codex-claude-adapter-design.md)
- [全局项目框架设计](2026-07-31-global-project-framework-design.md)
- [项目适配器设计](superpowers/specs/2026-07-31-project-adapter-design.md)
- [高吞吐全局交付协议设计](superpowers/specs/2026-08-03-high-throughput-global-delivery-design.md)
- [高吞吐全局交付协议实施计划](superpowers/plans/2026-08-03-high-throughput-global-delivery.md)
- [Codex–Claude 适配器实施计划](superpowers/plans/2026-07-31-codex-claude-adapter.md)
- [全局项目框架实施计划](superpowers/plans/2026-07-31-global-project-framework.md)
- [项目适配器实施计划](superpowers/plans/2026-07-31-project-adapter.md)
- [适配器试点方案](codex-adapter-pilot.md)
- [实际验证记录](pilot-results.md)
- [高吞吐交付试点](high-throughput-pilot.md)
- [主动框架学习规则与记录格式](framework-learning.md)
- [Claude 全量目录审查与共享能力裁决](shared-capability-catalog.md)
- [CC-Switch 能力登记同步脚本](../scripts/sync-cc-switch-skills.mjs)
- [Harness v1：项目级持续交付状态](harness-v1.md)
- [实现性项目迭代闭环](iteration-delivery.md)
- [强制 Harness 任务协议设计](superpowers/specs/2026-08-06-强制-harness-任务协议.md)
- [强制 Harness 任务协议实施计划](superpowers/plans/2026-08-06-强制-harness-任务协议.md)
- [Harness v1 交付评估闭环实施计划](superpowers/plans/2026-08-03-harness-evaluation-v1.md)
- [Harness P2：任务控制平面](harness-control-plane.md)
- [Harness P2 任务控制平面实施计划](superpowers/plans/2026-08-03-harness-control-plane-p2.md)
- [项目机械约束](project-constraints.md)
- [P1 项目机械约束实施计划](superpowers/plans/2026-08-03-project-constraints-p1.md)
- [Token、Harness 与最小充分验收 v0.19.0](2026-09-21-token-harness-v0190.md)

`plugins/leon-engineering-core/skills/*/SKILL.md` 与 `plugins/leon-engineering-workflows/skills/*/SKILL.md` 是工作流正文的唯一维护源；`adapters/codex/global-policy.md` 和 `adapters/codex/global-docs/` 是受管 Codex 全局层的唯一维护源。安装副本不应手工编辑，应通过适配器更新并验证。
