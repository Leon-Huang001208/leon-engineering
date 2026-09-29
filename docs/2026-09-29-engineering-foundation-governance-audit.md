# leon-engineering 工程底座治理审计

## 审计边界

- 主仓库：`Leon-Huang001208/leon-engineering`，本地权威 checkout 为 `/Users/leon/Developer/claude-engineering`。
- 参考仓库：`Leon-Huang001208/ResearchWorkbench`，当前远端 `master` 对应本地 Desktop checkout 的已跟踪文件。
- 审计日期：2026-09-29。
- 本文只记录已现场复核的事实。远端 CI、真实 Windows、真实宿主激活和发布均未执行。

## 仓库与环境基线

| 项目 | 分支 / commit | 工作区 | 远端核验 |
| --- | --- | --- | --- |
| leon-engineering | `main` / `fcc04b583f047dc01a0a02d233521ed2709364b5` | 干净；另有隔离治理 worktree | `origin/main` 现场 `ls-remote` 与本地一致 |
| ResearchWorkbench | `master` / `4d6a4eff6c64ef1580b0e86552d5c47391ff6dd7` | tracked 干净；存在任务外 untracked 报告、`.codex/` 与损坏虚拟环境目录 | `origin/master` 现场 `ls-remote` 与 Desktop checkout 一致 |

运行环境：macOS 14.6.1、Node.js v25.9.0、Git 2.33.0。未安装新依赖。`jq` 不可用，JSON 审计使用 Node.js 标准库完成。

当前任务在 `codex/engineering-foundation-governance` 隔离分支上推进。以下并发状态不属于本任务：

- leon 的 `codex/harness-v2-ledger` worktree 有 10 个未提交文件，所有权集中在 Harness ledger、Hook 和 Codex adapter；本任务不覆盖这些文件。
- RWB 的 `codex/platform-aware-minimal-acceptance` 是干净、已推到远端但尚未进入 `master` 的分支；它包含 schema-v3 / receipt-v2、平台路由和一个产品层 `service_manager.py` 修复。本任务只复用其已验证协议语义，不合并产品修复或整条分支。

## 当前测试基线

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| leon 全套 | `node --test tests/*.test.mjs` | 219 passed，0 failed，0 skipped，约 59.6 秒 |
| leon 格式 | `git diff --check` | 通过 |
| RWB 当前 master 策略/回执/Skill | `node --test tests/javascript/verification_policy.test.mjs tests/javascript/verification_receipt.test.mjs tests/javascript/incremental_validation_skill.test.mjs` | 85 passed，0 failed，0 skipped |
| RWB 平台分支协议合同 | planner、receipt、incremental Skill、cross-platform contract 四组 Node 测试 | 96 passed，0 failed，0 skipped |

## 入口与结构现状

leon 当前有 `.claude-plugin/`、`adapters/`、`agents/`、`docs/`、`hooks/`、`plugins/`、`scripts/` 和 `tests/`，但缺少根级 `README.md`、`AGENTS.md`、`.agents/`、`.github/`、`lib/`、`schemas/`、`templates/`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT_MAP.md` 和机器可读架构地图。

24 个 `scripts/*.mjs` 合计约 7,630 行。多个脚本同时承担 CLI、协议解析、存储和领域逻辑；`tests/` 直接导入脚本文件，使脚本路径同时成为公共入口和内部模块接口。`docs/README.md` 把现行指南、历史设计、实施计划和试点快照列在同一层级，读者无法机械区分当前规范与历史证据。

插件 ID 和版本当前稳定为：

- 核心：`leon-engineering` 0.19.3；
- 可选工作流：`leon-engineering-workflows` 0.19.3；
- 可选命令：`leon-engineering-commands` 0.19.3。

插件 ID、现有 Skill 正文位置、Hook JSON、公开脚本路径和安装 manifest 均属于兼容边界，不能通过目录整理顺手改名。

## 能力归属盘点

| 能力 | 当前权威实现 | 决定 |
| --- | --- | --- |
| Harness 任务、状态、观察和恢复 | `scripts/harness-*.mjs` 与对应测试 | 可直接复用；暂不触碰并发 `harness-v2-ledger` 所有文件 |
| 项目发现 | `scripts/profile-project.mjs`、profile schema | 复用；候选命令继续与真实执行证据分离 |
| 项目机械约束 | `scripts/project-constraints.mjs`、安装器 | 复用；leon 增加自身配置而不复制引擎 |
| 最小验收规划 | leon `verification-plan.mjs` v1；RWB planner v2；RWB 平台分支 v3 | 需参数化抽取并统一核心，保留三个兼容 envelope |
| 验收回执 | RWB receipt v1；平台分支 receipt v2 | 抽取为共享验证器；增加基线与摘要绑定，保留 legacy 只读验证 |
| 交付 | `scripts/iteration-delivery.mjs` | 直接复用；本目标明确不 publish，不改发布权限 |
| Token 审计 | `scripts/token-audit.mjs` | 直接复用；不以代理指标冒充 Token 降幅 |
| Skill 治理 | plugin split、`skill-portfolio.mjs`、catalog tests | 直接复用；不新增第二套顶层 Skill 目录 |
| 宿主适配 | Codex / Claude adapters | 复用；核心协议不反向依赖宿主 adapter |
| 安装升级 | Harness runtime manifest、Codex/Claude manifest 与回滚 | 扩展相对路径分发和项目受管最小运行时；保持旧 manifest 可读 |

## 验收协议差异

| 维度 | leon v1 | RWB master v2 | RWB 平台分支 v3 | 目标内部模型 |
| --- | --- | --- | --- | --- |
| 风险 | `read-only/local-only/isolated/full-delivery`，调用方传入 change kind | `docs-only/local-only/full-delivery`，策略按路径判定 | 同 v2 | 风险独立于验证深度和执行隔离 |
| 验证深度 | 无 L0-L4 | L0-L4 | L0-L4 | 保留 L0-L4；旧 v1 只做兼容映射 |
| 平台 | 无 | 无正式字段 | generic/macOS/Windows/cross-platform/real-machine | 有序平台集合，不把 generic 当全平台 |
| 执行 | test/lint + cwd/argv | local / external | local / CI / real-machine，merge / release gate | lane、gate、isolation 分开表达 |
| 匹配 | prefix | file/prefix/segment/suffix、delegated namespace | 同 v2 | 复用 v3 严格匹配与 fail-closed fallback |
| 升级 | change kind / tier | coupling + failure signal | 同 v2 | 保留原因、信号与最高风险合并 |
| 回执 | 只有 delivery receipt gate | receipt v1，校验漏项和外部门 | receipt v2，区分 merge/release readiness | v2 为新格式，legacy 只读兼容 |
| 新鲜度 | 无 | 当前 policy 复算；无 commit/hash 绑定 | 当前 policy 复算；无 commit/hash 绑定 | 绑定 base/head、完整 change set、policy/framework/plan 摘要 |

当前 leon planner 依赖调用方显式传入路径，且仓库自身没有 `.agents/verification-policy.json`；它不能证明 changed set 完整。RWB planner 的安全性和路由语义更完整，但核心仍在业务仓脚本中，且配置命令使用不可执行的字符串。平台分支已经验证 component/risk/platform、CI 与真实设备分离，但未进入当前 `master`，也没有框架版本或代码基线绑定。

## 旧入口到目标模块的迁移映射

| 旧入口 | 目标权威模块 | 兼容方式 |
| --- | --- | --- |
| `scripts/verification-plan.mjs` | `lib/verification/*` | 保留文件和 `buildVerificationPlan` 导出，变为 v1 adapter + CLI |
| RWB `scripts/plan_verification.mjs` | 同一共享核心的项目受管副本 | 保留路径、`planVerification` 导出、参数、错误 JSON 与退出码 |
| RWB `scripts/validate_verification_receipt.mjs` | `lib/verification/receipt.mjs` | 保留路径和导出；验证 legacy v2/v1 与新 v3/v2 |
| `scripts/harness-runtime.mjs` 的平面文件清单 | 通用分发清单 | 兼容旧 manifest，新增相对路径文件和资源哈希 |
| 手工复制项目脚本 | `lib/project/managed-runtime.mjs` + 薄 CLI | preview/apply/verify/rollback；manifest 声明归属和框架 commit |
| 人工架构清单 | `docs/architecture-map.json` | `lib/governance/architecture-map.mjs` 机械核对，不推导验收覆盖 |

## 已知阻塞与限制

- `harness-v2-ledger` 的未提交修改禁止本任务覆盖；若后续确需改同一文件，必须先重新核对所有权并单独处理。
- RWB Desktop checkout 的现有 untracked 内容属于用户或其他任务；RWB 接入只能在新 worktree 中进行。
- RWB 平台分支落后当前 `master` 且包含产品修复；不得直接 merge 作为工程接入捷径。
- 当前仓库无远端 CI；本任务可以新增并本地静态验证 workflow，但不得宣称远端运行通过。
- 不安装缺失的 Python/Node 工具；官方插件 validator 若仍因依赖缺失不可用，继续使用现有 Node 和结构检查并如实标记。

## 阶段结束条件

阶段 A 在本审计、设计文档和实施计划进入独立提交后完成。该提交只包含文档和导航，不改变运行时、安装、Hook、策略或 RWB 产品行为。
