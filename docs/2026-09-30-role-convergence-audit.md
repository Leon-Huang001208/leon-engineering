# 职责收敛与去重：首轮审计

日期：2026-09-30。此文件记录本轮观察、处置和后续事项；现行规则以源码、`AGENTS.md`、项目策略及模块指南为准。

## 基线与范围

- 主仓库来源：`/Users/leon/Developer/claude-engineering` 的干净 `codex/engineering-foundation-governance` worktree，基线 `5f0ddd1a0b09ab4581d9aa2a29967cf89025804f`。本轮在该提交的本地隔离副本 `codex/role-convergence` 中修改；原 worktree 和 Git common 私有目录未改动。
- 源仓 `main` 为 `fcc04b583f047dc01a0a02d233521ed2709364b5`，缺少本轮目标所列的新结构，因此不能作为本轮实现基线。
- 基线 `node --test tests/*.test.mjs`：266 passed、0 failed、0 skipped，60.7 秒。当前 CLI 为 `codex-cli 0.154.0`，Node 为 `v25.9.0`。本轮不发布、安装或重启宿主。
- 只读项目对照：`/Users/leon/Desktop/Projects/ResearchWorkbench`，`master` / `4d6a4eff6c64ef1580b0e86552d5c47391ff6dd7`；仅调用项目只读规划函数，未编辑或执行产品验证。

## 实际任务路径与权威源

| 环节 | 实现与调用 | 权威状态或证据 |
| --- | --- | --- |
| 开始任务 | Codex/Claude 宿主驱动原生任务；受管 `PreToolUse`/`PostToolUse` 调 `scripts/harness-hook.mjs`，经 `startHarnessSession` 自动建立/恢复项目记录；`harness-session.mjs` 保留显式入口 | `scripts/harness-project.mjs` 的任务 JSON、会话映射和追加事件 |
| 依赖与恢复 | 可选 `scripts/harness-control.mjs` 由显式 CLI 调用，读取账本任务并保存 DAG、状态、尝试次数和已存在 worktree 定位 | `control-plane.json` 只对依赖/恢复状态权威；完成前须读取任务最新 `completed/passed` 结果 |
| 发起执行 | 宿主工具执行一般命令；已登记、非交互 verifier 才可由 `harness-run.mjs` 调 `runObserved` | verifier 清单来自 Agent Map；观察日志和短回执来自 `harness-execution.mjs` |
| 生成验收计划 | `scripts/verification-plan.mjs` 调 `lib/verification/`，以项目 `.agents/verification-policy.json` 和完整 changed set 规划 | 项目策略为机器路由真源；绑定计划保存 Git 基线/摘要；planner 不执行验证 |
| 校验回执与完成 | `validate-verification-receipt.mjs` 复算计划和绑定、校验每个 ID 的证据；`harness-enforce.mjs` 检查开始事件、最新完成结果、验证完成事件及需要时的交付 receipt | 回执是验证证据，任务 JSON 是 outcome，控制状态是派生恢复视图；模型文字或控制状态不能单独证明完成 |

## 处置表

| 能力 | 源码及调用者 | 默认启用 | 所属层 | 处置 | 依据、兼容风险与验证方式 |
| --- | --- | --- | --- | --- | --- |
| 原生模型/工具/上下文 | Codex/Claude 宿主；框架只接 Hook/Skill | 宿主自有 | 宿主 | 保留宿主职责 | 框架未发现自行调用模型的普通任务入口；此为本轮路径审计结论，不是全仓不存在循环的证明。真实宿主行为未复测。 |
| Harness 任务与结果 | `harness-hook`/`harness-session` → `harness-project`，`harness-enforce` 读取 | 已受管项目 Hook 自动使用 | 工程治理 | 保留 | 最新 outcome、事件和交付 receipt 有独立硬门；删除会破坏失败语义。合同：`harness-project`、`harness-hook`、`harness-enforce` 测试。 |
| P2 依赖控制 | `harness-control.mjs`；仅显式 CLI/Skill 调用 | 否 | 可选工程交接 | 保留可选 | 只写 DAG/状态/定位，`--retry` 不运行任务，完成读取账本结果；没有第二个 Agent loop。合同：`harness-control.test.mjs`。 |
| 已知 verifier 观察 | `harness-run` → `harness-execution`，读取 `verifiers.json` | 仅显式调用 | 工程验证 | 保留 | 只执行登记 ID，日志/超时/失败回执独立于宿主文本。合同：`harness-execution.test.mjs`。 |
| 验收规划与回执 | `verification-plan` → `lib/verification`；`validate-verification-receipt` 复算 | 规划须显式调用 | 项目策略 + 共享内核 | 保留 | 策略独占 changed set 路由；计划和回执分别是意图与证据。缺失/过期/不匹配不能靠模型自报通过。固定合同：`verification-*`。 |
| `framework-focused` / `framework-full` | 本仓 policy 两个 ID；planner 按 ID 保留到 receipt | 混合 changed set 可同时选中 | 项目验收策略 | 候选，暂不改 | 对 `scripts/verification-plan.mjs` + `scripts/harness-project.mjs` 的只读规划确实列出两个相同 `node --test tests/*.test.mjs` 值；但 planner 不运行，receipt 分别要求 ID。本轮未证实 runner/CI 实际重复执行，直接合并有独立门与旧回执兼容风险。后续需有实际执行日志、语义及快照比较。 |
| Hook 初始化与事件 | `adapters/codex/hooks.json`、`hooks/hooks.json` → `harness-hook` | 受管安装且宿主激活后 | 薄适配 + 治理 | 保留 | pre/post 各记录不同事件；`startHarnessSession` 可恢复既有会话。仅源码审计未证明无变化加载成本或宿主递归触发；真实宿主未复测。 |
| Skill、架构地图、日期文档 | `plugins/*/skills/*/SKILL.md`、`docs/architecture-map.json`、`docs/README.md` | 文档/目录按需读取 | 工程治理 | 简化文档导航 | 原索引把 2026-09-29 的历史审计/设计/计划置于“当前”栏；改为现行入口与历史记录分开。Skill 正文和安装副本未改，架构地图只登记职责，不复制策略。 |

## 本轮减法与边界

已实施一项独立可验证的文档减法：修正索引中的“当前治理任务”重复权威暗示，并在 README、现行架构、开发地图及机器地图收敛职责措辞。没有证实运行逻辑的重复执行，因此本轮不改 policy、planner、receipt、Hook、安装或 CLI；框架测试、权限及平台门保持原契约。

官方 OpenAI [Agents API 会话文档](https://developers.openai.com/api/docs/guides/agents-api/sessions)说明其会话保存能力，[多代理文档](https://developers.openai.com/api/docs/guides/agents-api/multi-agent)说明原生委派；[插件文档](https://developers.openai.com/plugins/build/plugins)说明 Codex 生命周期 Hook 需要执行环境中的脚本和用户信任。这些文档支持职责划分，但 Agents API 能力不能直接推定本机 Codex CLI/桌面具备同一持久化、失败和权限语义，故未以宿主功能名删除工程账本或 Hook。

## ResearchWorkbench 只读对照

以当前 Desktop checkout 的 `AGENTS.md`、`docs/AGENT_WORKFLOW.md`、`.agents/verification-policy.json` 和 `scripts/plan_verification.mjs` 为准。该 planner 只读取项目与策略，不写项目或 Git common 状态；四次只读函数调用结果如下：

| 模拟单文件 changed set | 风险/层级 | 策略输出的主要本地/外部门 | 另需遵守的项目规则 |
| --- | --- | --- | --- |
| `docs/README.md` | docs-only / L0 | 文档治理、Python 索引；无 CI 项 | 仅计划对照，未验证文档变更 |
| `app/research_web/main.py` | local-only / L1 | Research Web 架构、文档治理、Python 索引；计划内无 CI 项 | Web 交付仍受 AGENTS 的 macOS 本地及干净安装 CI 要求；桌面门不适用 |
| `scripts/plan_verification.mjs` | full-delivery / L4 | 策略、回执、Skill 合同及 Web full；外部 project-constraints | 验收入口属于共享高风险边界；未执行任何合同或 CI |
| `scripts/setup_web.py` | full-delivery / L4 | 安装、架构、约束、关键 smoke、Web full；外部约束、Web checks 和 macOS bootstrap | 安装契约必须有干净安装 CI；桌面/Tauri/sidecar 门不适用 |

这里的等级和清单只是计划输出，不能写成产品验证已通过。普通 Web 单文件计划没有 CI 项，与 AGENTS 的 Web 交付 CI 要求应共同读取；后续可审计策略是否需更明确表达该外部门，不能在本轮只读范围内修改 RWB。

## 里程碑与后续

- A：完成基线、单路径调用链与候选处置；证据为上述源码/配置和只读规划输出。
- B：已更新现行定位及文档导航；机器地图仅更新职责和审计分类。
- C：仅实施文档导航减法；运行逻辑候选待实测，不制造重构。
- D：框架本地门和 minimal-project fixture 回归通过；RWB 只读计划已得到，不代表真实产品验收。

本地验证：`node scripts/check-architecture-map.mjs --project .` 返回 `valid: true`、10 modules、110 references；`node scripts/verification-plan.mjs --project . --base 5f0ddd1` 对完整六文件 changed set 给出 `local-only / L1`、`architecture-map-contracts`；`node scripts/project-constraints.mjs --project .` 带六次 `--changed-file` 返回零违反项。主体文档修改后的 `node --test tests/*.test.mjs` 为 266 passed、0 failed、0 skipped，55.7 秒，包含 `tests/fixtures/minimal-project/` 的通用路由、完整回执与 runtime 漂移合同。此后仅修正文档索引、地图缩进和本报告措辞，并对最终地图运行 `tests/architecture-map.test.mjs`，6/6 通过；`git diff --check` 覆盖六文件并通过。基线与修改后全量均无失败；没有新增回归。全量 TAP 本地保存在 `/private/tmp/leon-role-final-tests.tap`，计划保存在 `/private/tmp/leon-role-verification-plan.json`。

命令计数：基线和主体修改后各运行一次全量测试，同一状态重复全量运行 0 次；架构检查、策略规划和项目约束各两次（主体修改后及最终文档收尾），架构地图聚焦合同一次，RWB 只读场景规划四次。基线与修改后全量测试耗时分别为 60.7 秒和 55.7 秒；两次运行的代码状态和系统缓存可能不同，不能据此宣称提速。真实 Token/额度未测量。

后续独立任务：记录混合 changed set 的实际执行次数及每个 ID 的门、平台、环境、快照和回执需求；评估是否可在现有执行流程中复用同一次测试结果。另需在真实宿主对照 Hook 激活、递归/重复加载、会话恢复和跨宿主差异。Token/额度未测量；不从命令字符串或文档字节推断节省。
