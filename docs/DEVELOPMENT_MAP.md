# leon-engineering Development Map

本表回答“改哪里、先读什么、跑哪些固定合同、何时同步文档”。它不复制项目验收路由；实际 changed set 的最小充分验收由项目策略和 planner 决定。

`lib/` 维护宿主无关、项目无关的共享内核，`scripts/` 保持公开 CLI 兼容，`adapters/` 只处理宿主差异。下表中的 Skill 正文只在 `plugins/*/skills/*/SKILL.md` 编辑，受管安装副本通过安装器生成。项目 `.agents/verification-policy.json` 独占 changed set 到验收的机器路由；本表和机器地图只提供源码、文档与固定合同定位。

| 模块 | 源码 | 权威文档 | 主要固定合同 | 文档同步触发 |
| --- | --- | --- | --- | --- |
| Harness | `scripts/harness-*.mjs` | `harness-v1.md`、`harness-control-plane.md` | `harness-*.test.mjs` | 账本、状态、事件、观察、恢复或隐私边界变化；控制状态不驱动模型/任务执行 |
| Verification | `lib/verification/`、`schemas/verification-*.json`、`scripts/verification-plan.mjs` | 本文、治理设计、`2026-09-21-token-harness-v0190.md` | `verification-plan.test.mjs`、兼容/回执合同 | policy/plan/receipt schema、风险、深度、平台或证据语义变化（新 task 模式 plan4/receipt3，旧模式保持 plan3/receipt2） |
| Project discovery/runtime | `lib/project/`、`profile-project.mjs`、`project-runtime.mjs`、profile/runtime schema 与 `templates/project/` | 全局项目框架设计、治理设计 | `project-profile.test.mjs`、`project-runtime.test.mjs` | 发现事实、候选命令、受管项目运行时、manifest 或 project root 安全变化 |
| Project constraints | `project-constraints*.mjs` | `project-constraints.md` | `project-constraints*.test.mjs` | 约束 schema、安装或 CI 使用方式变化 |
| Delivery | `iteration-delivery.mjs` | `iteration-delivery.md` | `iteration-delivery.test.mjs`（真实冲突、非冲突失败、旧回执恢复、候选/base关联与stderr脱敏） | 分支、worktree、发布、CI、回滚或清理状态变化 |
| Resource lifecycle | `lib/resources/`、`resource-lifecycle.mjs` | `resource-lifecycle.md` | `resource-lifecycle.test.mjs`、`resource-integration.test.mjs` | 资源登记、阶段退休、缓存总预算、欠账、原文退休读取与宿主事件变化 |
| Governance | `lib/governance/`、Skill/profile 工具 | `ARCHITECTURE.md`、共享能力目录 | `architecture-map.test.mjs`、catalog/Skill tests | 模块归属、Skill 生命周期、文档分类或地图格式变化 |
| Token audit | `token-audit.mjs` | Token/Harness v0.19.0 设计 | `token-audit.test.mjs` | 指标、隐私、输入发现或输出预算变化 |
| Adapters | `adapters/`、`install-*-adapter.mjs` | Codex-Claude adapter 设计 | `codex-adapter.test.mjs`、`claude-adapter.test.mjs` | 受管文件、manifest、Hook 或宿主生命周期变化 |
| Plugins | `.claude-plugin/`、`plugins/` | `shared-capability-catalog.md` | `catalog.test.mjs`、reasoning Skill tests | 插件 ID/版本、缓存刷新、Skill 分组或默认启用状态变化 |
| 手动审计与角色 | `agents/`、显式 hook/audit/guard helpers | `harness-v1.md` 与 adapter 文档 | hook/audit/guard/catalog tests | Hook 输出协议、来源分工、Pre/Post事件退休、事件分类、恢复白名单、角色范围或非递归委派变化 |

## 文档类别

`skill-discovery-plan.mjs` 负责只读发现 canonical Skill 的全局同名入口并生成现有 portfolio 清单；操作说明见 [发现目录收敛](skill-discovery.md)，固定合同为 `skill-discovery-plan.test.mjs`。符号链接、来源不明入口和未授权的内容差异不会自动进入精确去重。

Harness 兼容辅助函数的 `withHarnessStorageContext` 只包围一次显式事件处理，避免辅助函数重复启动 Git 查询；没有默认 Hook 注册。复用结果的边界安全仍会检查；会话、账本、事件和旧目录迁移的真实读取继续走原固定合同，不缓存通过结果。

默认仅按需加载工程 Skills，不安装 Hook、不自动建立 Harness 账本。日常工程主入口为 `agent-routing`，其 `references/feature-development.md`、`defect-repair.md`、`review.md` 是三条子流程的唯一正文；旧 Skill 名称保留兼容转发。操作与边界见 [工程工作流](engineering-workflow.md)，路由、旧入口与平铺安装合同见 `tests/engineering-workflow.test.mjs`。

主入口正文预算及普通聊天/已知只读命令的反触发由同一固定合同检查；真实自然触发和宿主开销另用独立会话采样，不把文件字节或静态合同冒充 Token/整任务提速。外部同名入口仍按来源与用户授权处置，不降低分发验证器的 restored 检查。

测试设计与任务范围内的架构判断继续维护在 [feature-loop 的工程方法参考](../plugins/leon-engineering-core/skills/feature-loop/references/engineering-methods.md)，由功能与修复子流程及兼容入口引用。其旧路径与许可证保留；它不新增工作流或验收路由。引用、触发范围与来源许可仍由 `tests/catalog.test.mjs` 固定合同检查。

- 当前入口：根 README/AGENTS、`ARCHITECTURE.md`、本文件及模块现行指南；任务状态和证据不是宿主模型运行时。
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

## 框架自用

- `.agents/verification-policy.json` 是 leon 自身的 changed-file 路由真源；验收内核、schema、runtime、adapter、Hook、CI 和插件边界固定升级到 L4。
- `.agents/project-constraints.json` 检查入口、开发地图同步、共享内核依赖和 CI 固定命令。
- `.github/workflows/framework-checks.yml` 只声明本仓的轻量固定合同；远端未实际运行时不能报告 CI 已通过。
- `tests/fixtures/minimal-project/` 是不含业务项目路径的第二样例，证明配置驱动的局部验收、未知升级、回执和 runtime 漂移行为。

平台任务协议以 [Platform task verification](platform-task-verification.md) 为准：宿主任务通过与完整总体验收分开，runner/checkout/machine 身份是新模式硬门。
