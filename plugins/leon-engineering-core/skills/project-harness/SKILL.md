---
name: project-harness
description: Use when a user-selected project needs work to survive across Codex or Claude sessions, with a task goal, acceptance criteria, handoff state, and delivery metrics.
---

# 项目 Harness

只对用户明确选择的项目和任务使用仓库内 Harness。它是项目地图、证据账本和可恢复任务状态，不是全局记忆，也不能成为扫描无关仓库的理由。用户启用强制 Harness 后，所有会形成该项目交付、改动或调研结论的新任务必须自动开始或恢复 Harness；不得让用户手工建立账本。纯聊天和未指定项目的知识问答不写入项目。

先确认受管运行时可用；它位于所有宿主共用的稳定用户目录，不得把脚本复制到项目 `scripts/`：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-runtime.mjs" --verify
```

若校验提示缺失或漂移，必须从受管框架源运行安装器完成安装并再次校验；不得用项目内相对脚本路径或手工复制绕过清单。新任务由 Agent 自动通过会话入口创建；每个新的用户任务使用 `--new-task` 与新的不透明任务键，任务延续时使用同一任务键恢复：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-session.mjs" --start --new-task --project /absolute/project --host codex --session-id opaque-task-key --task-id task-id --goal "Outcome" --acceptance "Observable result"
```

会话入口在逻辑 Harness 目录创建 `agent-map.md`、任务记录、轻量 `task-index.jsonl`、`metrics.jsonl`、隐私受限的 `events.jsonl` 和会话上下文。Git 仓库的逻辑目录固定在 Git common dir 的 `leon-engineering/harness/`，主 checkout 与所有 linked worktree 共用；非 Git 项目继续使用 `.ai/harness/`。这样普通功能/集成 worktree 被安全移除后，结果记录、评估和交付硬门仍可从主 checkout 完成。会话文件使用 `host + session ID` 的不可逆摘要隔离 Claude 与 Codex；同宿主旧键会复制到新命名空间后恢复，旧文件保留，异宿主旧记录既不覆盖也不阻止当前宿主建立独立上下文。读取端兼容结构一致的 v1/v2 会话记录，并继续严格校验摘要键、宿主和任务记录；损坏或不匹配记录仍进入只读诊断模式。事件流只记录任务 ID、宿主、事件类别及白名单状态，不记录目标、验收、会话 ID、命令、路径、提示词、源代码或密钥。对未启用强制 Harness 的项目，仍保持原有的预览与明确写入边界。

Git 仓库升级前若已有项目内 `.ai/harness/`，运行时会拒绝建立第二份账本。先只读预览，再显式迁移；迁移逐文件哈希校验并保留旧目录，不自动删除：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-storage.mjs" --preview --project /absolute/project
node "$HOME/.agents/leon-engineering/runtime/harness-storage.mjs" --migrate --project /absolute/project
```

符号链接、不可读记录、路径逃逸或内容不同的同名任务都会 fail closed。成功迁移写入版本化 manifest 与 rollback map，目录权限为 `0700`、文件权限为 `0600`。

Agent Map 同时在逻辑 Harness 目录生成 `verifiers.json`。每个已知非交互 verifier 都有稳定 verifier ID、命令、相对工作目录、来源和参数数组；只有该机器清单中的 ID 可由观察执行层运行。深模块公开 `runObserved(spec)` 与 `readObservation(query)`，薄 CLI 只接受 verifier ID 或 observation ID：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-run.mjs" --project /absolute/project --task-id task-id --verifier-id verifier-test-0123456789ab
node "$HOME/.agents/leon-engineering/runtime/harness-run.mjs" --project /absolute/project --task-id task-id --read-observation observation-0123456789abcdef01234567
```

未登记命令继续使用宿主原生 `exec_command`，不得把命令动态写入 verifier 清单来绕过边界。观察层把完整 stdout/stderr 以 `0600` 保存在逻辑目录的 `logs/<task-id>/`，拒绝符号链接与路径穿越且不自动删除。普通调用最多返回 4 KiB；只有显式 `wideReceipt: true` 才放宽到 8 KiB。超过预算时返回含头、尾、错误上下文、SHA-256和日志引用的去重短回执；错误状态、退出码和超时原因不得省略。疑似秘密不进入模型可见回执或回查；原文只保存在本地。主归档失败时使用持久本地 fallback 保留证据。

`metrics.jsonl` 的 `observation_recorded` 与 `observation_recalled` 只保存 verifier ID、状态、耗时、字节量、截断、归档失败标记和回查次数，不保存命令正文、日志引用、哈希或输出。评估器据此报告样本量、返回字节比、回查率、归档失败率及重复 verifier 的结果一致率。

未启用强制 Harness 时，可在用户明确授权后继续使用 `harness-project.mjs --write-harness` 创建首个账本；该兼容入口不会覆盖既有 Harness。

一个已有 Harness 需要新增后续任务时，必须显式创建对应账本记录；这不会改写 Map 或已有任务。P2 控制计划中的每项都必须以 `harnessTaskId` 明确引用一个这样的记录：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-project.mjs" --project /absolute/project --task-id implement --goal "实施变更" --acceptance "聚焦测试通过" --add-task
```

任务完成时只记录已经观察到的证据。`--record-outcome` 绝不运行其声明的验证命令；执行代理必须在记录 `passed` 前自行实际完成验证。记录实测验证秒数。受阻任务还必须选择一个标准阻塞类别：`environment`、`dependency`、`permission`、`requirements`、`test`、`external` 或 `unknown`。

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-project.mjs" --project /absolute/project --task-id task-id --record-outcome --status completed --clarification-rounds 0 --rework-count 0 --verification-command "npm test" --verification-status passed --verification-duration-seconds 18
node "$HOME/.agents/leon-engineering/runtime/harness-enforce.mjs" --project /absolute/project --task-id task-id
```

`harness-enforce` 是只读交付硬门：它要求同一任务具有 `task_started`、真实的 `completed/passed` 结果、实测验证耗时和 `verification_completed` 事件；不会运行记录中的验证命令。Codex 与 Claude 的 `PreToolUse`/`PostToolUse` Hook 都会在本地工具边界自动建立或恢复上下文并记录非敏感事件。初始化失败时，仅允许明确分类为 `diagnostic_read` 的恢复诊断，例如 `pwd`、配置或指令读取、`rg`/只读 `sed`、Git 只读命令和受管 runtime `--verify`；`mutation` 与 `unknown` 一律 fail closed。Hook 输出只包含失败阶段、稳定错误码、受管 runtime/manifest 路径和恢复建议，不回显原始工具输入或异常文本。Hook 不能替代真实验证，仍由该硬门和项目 CI 机械验收。

安装副本直接执行 `harness-runtime.mjs --verify` 时只按清单检查自身且不创建缺失目录；Codex/Claude 适配器从权威源验证时还会比较源码校验和，以拒绝内部一致但相对源码陈旧的安装。

要审阅指定项目已记录的交付证据，使用只读评估器。它不创建 Harness、不写报告文件，也不运行任务声明的命令：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-evaluate.mjs" --project /absolute/project --task-id task-id --format markdown
node "$HOME/.agents/leon-engineering/runtime/harness-evaluate.mjs" --project /absolute/project --all --format markdown
node "$HOME/.agents/leon-engineering/runtime/harness-evaluate.mjs" --project /absolute/project --rebuild-index
```

单任务模式严格读取目标记录；`--all` 只读 `task-index.jsonl`，未索引或损坏证据返回不完整报告而不伪造通过。索引重建是显式写操作，使用有界并发与超时，不为历史记录下载 dataless 文件。报告指标时要包含样本量和验证耗时覆盖率。不得凭猜测回填历史时长或阻塞类别。

需要把风险、变更类型和路径映射为最小充分验收时，先生成只读计划；规划器不执行命令，未知路径自动升级：

```bash
node "$HOME/.agents/leon-engineering/runtime/verification-plan.mjs" --project /absolute/project --risk-tier local-only --change-kind internal --changed-file services/example.py
```

当一个已初始化 Harness 的项目有三个或更多相互依赖的任务、需要在中断后恢复，或需要对失败任务作一次明确重试时，使用 P2 控制平面。先为每项控制任务创建账本记录，并在项目内计划中声明不可省略的 `harnessTaskId`；再只读预览：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --task-plan /absolute/project/control-plan.json
```

只有该项目的写入已获授权时，才可加入 `--write-control-plane`。它把 DAG、状态、尝试次数、事件和执行者已经创建的 worktree 定位信息保存为逻辑 Harness 目录的 `control-plane.json`。后续转换、重试和登记均是独立的显式命令；`--retry` 绝不自动执行。

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --transition --task-id implement --status in_progress --reason "执行者开始处理"
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --retry --task-id implement --reason "已修正失败原因，明确重试"
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --register-worktree --task-id implement --worktree /absolute/existing-worktree --branch codex/example --base-commit 03c0ca0
```

控制任务转为 `completed` 前，运行时会读取其 `harnessTaskId` 的最新账本结果，且只接受 `completed` 与 `passed`；控制状态本身不是验证证据。可用 `--show` 恢复查看状态，评估器只读汇总，不替代逐任务证据检查。

控制平面不创建、删除或切换 worktree，不启动常驻 Agent，不自动重试，不运行测试、构建、Git 或任务命令。登记的路径、分支和基准提交是执行者声明的恢复定位信息，不是脚本对工作区健康度的验证。

项目的 CI、指令或候选命令变化后，只有用户明确授权写入该项目时才可刷新既有 Agent Map：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-project.mjs" --project /absolute/project --refresh-agent-map
```

该操作仅重写逻辑 Harness 目录的 `agent-map.md` 并追加 `agent_map_refreshed` 事件；不得删除、替换或伪造任务结果和指标账本。
