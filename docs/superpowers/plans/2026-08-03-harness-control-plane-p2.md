# Harness P2：持久任务控制平面实施计划

> **执行约定：** 本计划由当前会话内联执行；每一项先写失败测试，再实施最小代码，并在提交前做完整验证。

**目标：** 为已初始化 Harness 的单一项目提供可持久化的任务状态机、依赖 DAG、人工显式重试与 worktree 登记，使中断后的会话能恢复准确任务状态而不启动常驻 Agent 或自动执行任务。

**架构：** 新增独立的 `harness-control.mjs`，只在项目既有 `.ai/harness/` 下读写 `control-plane.json`。任务计划包含目标、验收条件与依赖；状态派生与状态转换均在脚本内校验，事件账本只保存调用方显式提供的理由和元数据。脚本不运行任务、测试、Git 或网络命令，也不创建、删除或切换 worktree；它仅登记已由执行者创建的工作区定位信息。

**技术栈：** Node.js 内置 `fs`、`path`、`crypto` 和 `node:test`；JSON 持久化与原子写入。

---

## 文件职责

| 文件 | 改动 | 职责 |
|---|---|---|
| `scripts/harness-control.mjs` | 新增 | 构建、校验、预览及显式写入任务控制平面。 |
| `tests/harness-control.test.mjs` | 新增 | 覆盖 DAG、状态转换、显式重试、worktree 登记、CLI 零写入和安全拒绝。 |
| `skills/project-harness/SKILL.md` | 修改 | 在存在依赖、恢复或重试需求时路由到 P2，明确权限边界。 |
| `docs/harness-control-plane.md` | 新增 | 说明 JSON 格式、命令、状态图和不自动化的边界。 |
| `docs/harness-v1.md`、`docs/README.md`、全局技能指南 | 修改 | 将 P2 纳入共享 Harness 文档入口。 |
| `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` | 修改 | 将已发布共享框架版本升至 `0.10.0`。 |

## 任务 1：定义只读计划预览与 DAG 校验

- [x] 新建 `tests/harness-control.test.mjs`，构造含 `collect → implement → verify` 的任务计划；断言未完成依赖只使 `collect` 就绪，环状依赖与未知依赖被拒绝，且读取预览不创建 `.ai/harness/control-plane.json`。
- [x] 运行 `node --test tests/harness-control.test.mjs`，确认因模块不存在而失败。
- [x] 新建 `scripts/harness-control.mjs`，导出 `buildControlPlane` 与 `previewControlPlane`；只接受安全任务 ID、非空目标、至少一个验收条件和不重复依赖；检测自依赖、未知 ID 与环。
- [x] 再次运行目标测试，确认 DAG 与零写入断言通过。

## 任务 2：增加显式持久化、状态转换、重试与工作区恢复登记

- [x] 扩展同一测试：初始化控制平面须明确 `--write-control-plane`；`ready → in_progress → completed` 后解锁依赖任务；失败或阻塞只能由显式 `--retry` 变回就绪并增加尝试次数；`--register-worktree` 只保存绝对路径、分支与基准提交，不调用 Git 或创建工作区。
- [x] 运行目标测试，确认因缺少写入与转换 API/CLI 而失败。
- [x] 实施 `writeControlPlane`、`transitionTask`、`retryTask`、`registerWorktree` 和 CLI 参数解析；以原子写入保存 `control-plane.json`，拒绝符号链接、跨项目路径、无效转换与非显式写入。
- [x] 运行 `node --test tests/harness-control.test.mjs`，确认全部通过。

## 任务 3：更新路由文档与跨宿主发布材料

- [x] 先执行无 P2 指引的压力场景，记录 agent 对“依赖任务、自动重试、worktree 恢复”的默认回答，确认它没有擅自创建或执行任务。
- [x] 更新 `skills/project-harness/SKILL.md`：P2 只对已有 Harness、用户指定项目和明确 DAG/恢复需求适用；默认预览；每次写入、重试和工作区登记均须显式命令；禁止自动执行、自动重试、自动 worktree 操作。
- [x] 用同一场景复核 skill，确认它给出 P2 的只读预览和明确授权边界。
- [x] 编写 `docs/harness-control-plane.md`，并更新 Harness v1、文档索引、Codex/Claude 全局技能指南和插件版本。
- [x] 运行 `node --test tests/*.test.mjs`、`node --check scripts/harness-control.mjs`、插件 JSON 校验与 `git diff --check`；均以零失败结束。
- [ ] 提交并在主分支快进合并；之后通过受管适配器安装/验证 Codex 与 Claude 的共享副本。真实 GitHub/Windows runner 未触发前，只报告其未验证状态。

## 覆盖审查

- 状态机：任务从计划、就绪、进行中、阻塞、失败到完成均有受限转换。
- DAG：创建时校验 ID、依赖存在性与环；完成上游后才解锁下游。
- 恢复：保存任务的 branch、baseCommit 与绝对 worktree 路径，但不对本地 Git 状态作未经证实的声明。
- 重试：仅调用者明确执行，记录理由并递增尝试次数；不存在后台或隐式重试。
- 安全：默认零写入；所有写入局限在既有用户指定项目的 `.ai/harness/`，拒绝符号链接和路径逃逸；不执行任务声明的命令。
