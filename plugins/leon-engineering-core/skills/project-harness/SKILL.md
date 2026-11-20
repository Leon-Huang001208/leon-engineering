---
name: project-harness
description: Use when project rules or the current task explicitly select a cross-session task ledger, handoff, recovery state, observations or delivery metrics.
---

# 项目 Harness

仅当项目规则或当前任务显式选择 Harness 时使用。普通工程任务不建账本，不因存在 Git 仓库、AGENTS.md 或旧记录而自动纳管。它不是全局记忆，也不授予扫描或修改其他项目的权限。

## 显式开始与恢复

运行时不是默认安装内容。从用户选定的框架源执行 `node scripts/harness-runtime.mjs --install`，或先对已有受管运行时执行自检：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-runtime.mjs" --verify
node "$HOME/.agents/leon-engineering/runtime/harness-session.mjs" --start --new-task --project /absolute/project --host codex --session-id opaque-task-key --task-id task-id --goal "Outcome" --acceptance "Observable result"
```

项目或任务已经选定账本且具备写入授权时，由执行代理完成命令；续接同一任务复用任务键。自检失败从已核实的源修复，不复制脚本绕过 manifest。Git 项目的状态位于 Git common dir 的 `leon-engineering/harness/`；非 Git 项目使用 `.ai/harness/`，不把工作树路径当作长期身份。

旧 `harness-project.mjs --write-harness` 保留为已获准首建账本的兼容入口，不覆盖既有记录。

已有旧账本时先预览迁移，再按授权迁移；不建立第二份平行记录，不覆盖漂移内容：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-storage.mjs" --preview --project /absolute/project
node "$HOME/.agents/leon-engineering/runtime/harness-storage.mjs" --migrate --project /absolute/project
```

## 验证与记录

先实际运行项目检查，再记录已经观察到的结果。记录命令不执行它所声明的测试；未运行、失败或平台未覆盖如实保留。

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-project.mjs" --project /absolute/project --task-id task-id --record-outcome --status completed --clarification-rounds 0 --rework-count 0 --verification-command "npm test" --verification-status passed --verification-duration-seconds 18
node "$HOME/.agents/leon-engineering/runtime/harness-enforce.mjs" --project /absolute/project --task-id task-id
```

已选择该流程的项目保留 `task_started`、真实 completed/passed 结果、实测耗时和完成事件的检查。账本不替代测试、CI 或平台证据，也不随工具调用自动更新。

需要观察执行时仅运行已登记的 verifier ID；未知命令用原生工具，不向清单注入任意字符串。完整输出留本机私有日志，回执保留错误、退出码、哈希和定位信息，不记录或输出秘密。只有明确选择资源生命周期策略时，才使用其登记与退休；旧恢复证据继续保护。

跨任务依赖、中断恢复或明确重试需要 P2 状态时，再读取源目录的 `docs/harness-control-plane.md`。它不创建 worktree、不运行任务命令、不自动重试。评估、索引重建和 Map 刷新仍是各自显式命令；写入范围与项目授权不变。完整命令和协议见源目录 `docs/harness-v1.md`。
