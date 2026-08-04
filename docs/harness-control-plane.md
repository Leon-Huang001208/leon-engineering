# Harness P2：任务控制平面

P2 为一个已经初始化 `.ai/harness/` 的、用户明确选择的项目保存可恢复的多任务状态。它解决“会话中断后不知道哪个任务可继续、哪个任务被依赖阻塞、失败是否已经重试、隔离工作区在哪里”的问题；不替代项目管理平台，也不自动执行工作。每个控制任务用 `harnessTaskId` 绑定账本任务：控制状态本身不是验证证据。

## 任务计划和默认预览

任务计划是项目内的 JSON 文件，内容为数组或带 `tasks` 数组的对象。每项都必须有安全的 `id`、指向既有账本任务的 `harnessTaskId`、非空 `goal`、至少一条 `acceptanceCriteria` 及 `dependsOn` 数组。控制平面不会替计划创建账本任务；先用 `harness-project.mjs --add-task` 显式创建它们：

```json
{
  "tasks": [
    {"id": "collect", "harnessTaskId": "collect", "goal": "收集证据", "acceptanceCriteria": ["证据已记录"], "dependsOn": []},
    {"id": "implement", "harnessTaskId": "implement", "goal": "实施变更", "acceptanceCriteria": ["聚焦测试通过"], "dependsOn": ["collect"]},
    {"id": "verify", "harnessTaskId": "verify", "goal": "验证交付", "acceptanceCriteria": ["验收证据已保存"], "dependsOn": ["implement"]}
  ]
}
```

先运行只读预览。它校验重复 ID、未知依赖、自依赖和环，并给出可开始的任务；不会创建文件：

```bash
node scripts/harness-control.mjs --project /absolute/project --task-plan /absolute/project/control-plan.json
```

只有在用户明确授权写入该项目且 Harness 已存在时，才持久化：

```bash
node scripts/harness-control.mjs --project /absolute/project --task-plan /absolute/project/control-plan.json --write-control-plane
```

写入目标固定为 `.ai/harness/control-plane.json`。已有文件、符号链接、项目外计划文件和路径逃逸都会被拒绝。

## 状态和恢复

状态为 `planned`、`ready`、`in_progress`、`blocked`、`failed` 和 `completed`。没有未完成依赖的任务为 `ready`；上游完成时，下游由 `planned` 显式派生为 `ready` 并记录事件。允许的业务转换只有：

```text
ready → in_progress → completed
                    ↘ blocked
                    ↘ failed
blocked / failed --(明确 --retry)--> ready 或 planned
```

每项状态转换和重试都必须提供实际理由。转为 `completed` 前，运行时读取该任务 `harnessTaskId` 对应记录的最后一条 outcome，只有 `status: completed` 且 `verification.status: passed` 才允许转换；控制平面的状态或聚合评估均不能替代该证据：

```bash
node scripts/harness-control.mjs --project /absolute/project --transition --task-id implement --status failed --reason "聚焦测试实际失败"
node scripts/harness-control.mjs --project /absolute/project --retry --task-id implement --reason "失败原因已修正，执行者明确重试"
```

如果执行者已经通过项目约定创建了隔离 worktree，可登记其恢复定位信息：

```bash
node scripts/harness-control.mjs --project /absolute/project --register-worktree --task-id implement --worktree /absolute/existing-worktree --branch codex/example --base-commit 03c0ca0
```

此操作只保存绝对路径、分支和基准提交，**不**创建、删除、切换或通过 Git 验证该 worktree。恢复会话仍必须依据项目规则检查实际工作区、改动和验证结果。

## 证据边界

控制平面不运行任务、测试、构建、Git 或网络命令，不会把登记信息当成已验证状态。任务的实际结果仍由 `harness-project.mjs --record-outcome` 保存，且 `passed` 只能对应执行代理实际运行过的验证。恢复时使用 `--show` 读取持久化状态，并重新核对每个 `harnessTaskId` 的账本结果；P2 的事件记录只用于交接和恢复，不可替代 CI、原生平台验证或安装级冒烟测试。
