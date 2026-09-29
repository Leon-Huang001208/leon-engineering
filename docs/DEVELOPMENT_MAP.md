# leon-engineering Development Map

本表回答“改哪里、先读什么、跑哪些固定合同、何时同步文档”。它不复制项目验收路由；实际 changed set 的最小充分验收由项目策略和 planner 决定。

| 模块 | 源码 | 权威文档 | 主要固定合同 | 文档同步触发 |
| --- | --- | --- | --- | --- |
| Harness | `scripts/harness-*.mjs` | `harness-v1.md`、`harness-control-plane.md` | `harness-*.test.mjs` | 账本、状态、事件、观察、恢复或隐私边界变化 |
| Verification | `lib/verification/`、`schemas/verification-*.json`、`scripts/verification-plan.mjs` | 本文、治理设计、`2026-09-21-token-harness-v0190.md` | `verification-plan.test.mjs`、兼容/回执合同 | policy/plan/receipt schema、风险、深度、平台或证据语义变化 |
| Project discovery/runtime | `lib/project/`、`profile-project.mjs`、`project-runtime.mjs`、profile/runtime schema 与 `templates/project/` | 全局项目框架设计、治理设计 | `project-profile.test.mjs`、`project-runtime.test.mjs` | 发现事实、候选命令、受管项目运行时、manifest 或 project root 安全变化 |
| Project constraints | `project-constraints*.mjs` | `project-constraints.md` | `project-constraints*.test.mjs` | 约束 schema、安装或 CI 使用方式变化 |
| Delivery | `iteration-delivery.mjs` | `iteration-delivery.md` | `iteration-delivery.test.mjs` | 分支、worktree、发布、CI、回滚或清理状态变化 |
| Governance | `lib/governance/`、Skill/profile 工具 | `ARCHITECTURE.md`、共享能力目录 | `architecture-map.test.mjs`、catalog/Skill tests | 模块归属、Skill 生命周期、文档分类或地图格式变化 |
| Token audit | `token-audit.mjs` | Token/Harness v0.19.0 设计 | `token-audit.test.mjs` | 指标、隐私、输入发现或输出预算变化 |
| Adapters | `adapters/`、`install-*-adapter.mjs` | Codex-Claude adapter 设计 | `codex-adapter.test.mjs`、`claude-adapter.test.mjs` | 受管文件、manifest、Hook 或宿主生命周期变化 |
| Plugins | `.claude-plugin/`、`plugins/` | `shared-capability-catalog.md` | `catalog.test.mjs`、reasoning Skill tests | 插件 ID/版本、Skill 分组或默认启用状态变化 |
| Hooks and agents | `hooks/`、`agents/`、hook/audit/guard scripts | Harness 与 adapter 文档 | hook/audit/guard/catalog tests | 事件分类、恢复白名单、角色范围或非递归委派变化 |

## 文档类别

- 当前入口：根 README/AGENTS、`ARCHITECTURE.md`、本文件及模块现行指南。
- 决策：设计文档与明确的架构取舍。
- 实施计划：`docs/superpowers/plans/`，只描述任务，不证明已完成。
- 证据快照：日期报告、pilot results 与审计回执；结论可能随版本失效。
- 生成内容：由脚本重建并检查，不在叙述文档手工维护文件/符号清单。
- 归档：已退出当前使用路径但仍需保留的历史材料。

修改结构或引用后运行：

```bash
node scripts/check-architecture-map.mjs --project .
node --test tests/architecture-map.test.mjs tests/catalog.test.mjs
git diff --check
```
