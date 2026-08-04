---
name: project-harness
description: Use when a user-selected project needs work to survive across Codex or Claude sessions, with a task goal, acceptance criteria, handoff state, and delivery metrics.
---

# 项目 Harness

只对用户明确选择的项目和任务使用仓库内 Harness。它是项目地图、证据账本和可恢复任务状态，不是全局记忆，也不能成为扫描无关仓库的理由。

先确认受管运行时可用；它位于所有宿主共用的稳定用户目录，不得把脚本复制到项目 `scripts/`：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-runtime.mjs" --verify
```

若校验提示缺失或漂移，必须从受管框架源运行安装器完成安装并再次校验；不得用项目内相对脚本路径或手工复制绕过清单。运行时可用后，预览不得写文件：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-project.mjs" --project /absolute/project --task-id task-id --goal "Outcome" --acceptance "Observable result"
```

只有用户授权向该确切项目写入任务状态后，才可使用 `--write-harness`。它创建 `.ai/harness/agent-map.md`、一个任务记录和 `metrics.jsonl`；拒绝覆盖既有状态。

任务完成时只记录已经观察到的证据。`--record-outcome` 绝不运行其声明的验证命令；执行代理必须在记录 `passed` 前自行实际完成验证。记录实测验证秒数。受阻任务还必须选择一个标准阻塞类别：`environment`、`dependency`、`permission`、`requirements`、`test`、`external` 或 `unknown`。

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-project.mjs" --project /absolute/project --task-id task-id --record-outcome --status completed --clarification-rounds 0 --rework-count 0 --verification-command "npm test" --verification-status passed --verification-duration-seconds 18
```

要审阅指定项目已记录的交付证据，使用只读评估器。它不创建 Harness、不写报告文件，也不运行任务声明的命令：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-evaluate.mjs" --project /absolute/project --format markdown
```

报告指标时要包含样本量和验证耗时覆盖率。不得凭猜测回填历史时长或阻塞类别。陌生仓库先使用 `project-adapter`。不得把秘密、未执行结果、私密对话或项目事实写入全局策略。

当一个已初始化 Harness 的项目有三个或更多相互依赖的任务、需要在中断后恢复，或需要对失败任务作一次明确重试时，使用 P2 控制平面。先将任务计划放在该项目内部，再只读预览：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --task-plan /absolute/project/control-plan.json
```

只有该项目的写入已获授权时，才可加入 `--write-control-plane`。它把 DAG、状态、尝试次数、事件和执行者已经创建的 worktree 定位信息保存为 `.ai/harness/control-plane.json`。后续转换、重试和登记均是独立的显式命令；`--retry` 绝不自动执行。

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --transition --task-id implement --status in_progress --reason "执行者开始处理"
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --retry --task-id implement --reason "已修正失败原因，明确重试"
node "$HOME/.agents/leon-engineering/runtime/harness-control.mjs" --project /absolute/project --register-worktree --task-id implement --worktree /absolute/existing-worktree --branch codex/example --base-commit 03c0ca0
```

控制平面不创建、删除或切换 worktree，不启动常驻 Agent，不自动重试，不运行测试、构建、Git 或任务命令。登记的路径、分支和基准提交是执行者声明的恢复定位信息，不是脚本对工作区健康度的验证。
