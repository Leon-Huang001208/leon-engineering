# 全局工程工作流：命令与验证

全局框架不替项目选择构建或测试命令。先从目标仓库的文档、脚本和 CI 中确认命令，再执行最小且相关的验证。快路径只运行目标验证，不把项目档案生成、全量测试或全局适配器校验混入普通项目交付。

安装器仅维护它拥有的全局内容。以下命令需要从 `leon-engineering` 源仓库运行：

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --verify-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --rollback-global --codex-home "$HOME/.codex"
```

`--install-global` 会先拒绝与用户文件冲突的文档或未受管策略区块。`--verify-global` 只读检查策略和六份文档。`--rollback-global` 只在内容未漂移时移除该框架拥有的文档和标记区块；它不会修改技能、插件、模型、MCP、凭据或项目。

本地 Claude 插件已经安装时，`claude plugin install` 只会报告“已安装”，不会刷新缓存版本。框架源码的插件版本升级后，应使用下面命令，并在现有 Claude Code 会话中重启后才会生效：

```bash
claude plugin update leon-engineering@leon-local --scope user
claude plugin list
```

技能安装与全局文档安装是独立操作。不要用全局框架命令代替目标项目的测试、lint、构建、浏览器检查或平台验证。实际运行过的命令和结果才可作为交付证据。

对用户指定的陌生项目，可从源仓库运行以下只读命令：

```bash
node scripts/profile-project.mjs --project /absolute/project --format markdown
```

它只检查固定的指令、清单、CI 和平台路径，输出的命令均标为 `candidate`，不会执行。只有用户针对该项目明确授权后，才可加入 `--write-profile` 创建 `.ai/project-profile.json`；已有档案还需要 `--replace-profile` 才会更新。安装全局框架本身不会调用该命令或扫描任何项目。

对已启用强制 Harness 的目标项目，Agent 自动开始新任务；用户不需要先运行命令。新任务使用 `--new-task`，连续处理同一任务时省略它以恢复上下文：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-session.mjs" --start --new-task --project /absolute/project --host codex --session-id opaque-task-key --task-id task-id --goal "目标" --acceptance "验收标准"
```

完成任务后，执行者先独立运行验证，再用 `--record-outcome` 写入已经观察到的状态、澄清轮次、返工次数、实测验证秒数和验证命令；记录命令本身不会运行该验证命令。`blocked` 结果还必须写入标准化阻塞分类，不能从推测补填。随后运行只读交付硬门；它不会执行任务命令，但会拒绝缺少开始事件、通过验证结果或验证完成事件的交付：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-enforce.mjs" --project /absolute/project --task-id task-id
```

要查看该项目已记录的交付指标，运行只读评估；它不会创建文件、执行账本内命令或扫描其他项目：

```bash
node scripts/harness-evaluate.mjs --project /absolute/project --format json
node scripts/harness-evaluate.mjs --project /absolute/project --format markdown
```

报告中的一次通过率、平均值只针对已有结果；验证耗时覆盖率不足时，不得把它解释为项目实际速度。

对已经初始化 Harness 的依赖任务、中断恢复或显式重试，先预览项目内任务计划；它不创建控制文件、不运行任务命令：

```bash
node scripts/harness-control.mjs --project /absolute/project --task-plan /absolute/project/control-plan.json
```

只有获得对该项目的明确写入授权后才加 `--write-control-plane`。状态转换、失败/阻塞重试和 worktree 登记均须使用独立显式命令与实际理由。该脚本不创建、切换或删除 worktree，不自动重试，也不运行 Git、测试、构建或任务命令；登记的 worktree 路径、分支和基准提交只是恢复定位信息。

需要把用户已授权项目的架构、文档联动、日志/错误处理或平台规则作为机械检查时，使用受跟踪的项目配置和只读检查器：

```bash
node scripts/project-constraints.mjs --project /absolute/project
node scripts/project-constraints.mjs --project /absolute/project --changed-file services/example.py --changed-file docs/CHANGELOG.md
```

检查器不执行 Git、测试或构建；CI 应自行取得相对变更路径并传给 `--changed-file`。创建或修改 `.agents/project-constraints.json` 与 CI 仍需要用户对该项目的明确授权。

供 CI 调用的项目内副本也必须显式安装：`node scripts/install-project-constraints.mjs --project /absolute/project --write`。它只复制检查器到 `.agents/project-constraints.mjs`；升级已有副本必须额外传入 `--replace`。
