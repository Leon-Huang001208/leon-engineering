# 全局工程工作流：命令与验证

全局框架不替项目选择构建或测试命令。先从目标仓库确认命令，再按只读快路径、窄小改本地环、中高风险隔离实现、明确发布/高风险完整交付执行最小充分验证。快路径不把项目档案生成混入普通交付；独立只读检查同轮批量执行。普通回执目标 ≤4 KiB、宽查询最多 8,000 字符，全文留本地并返回摘要、SHA-256 与定点回查方式。

安装器仅维护它拥有的全局内容。以下命令需要从 `leon-engineering` 源仓库运行：

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --verify-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --rollback-global --codex-home "$HOME/.codex"
```

`--install-global` 会先拒绝与用户文件冲突的文档或未受管策略区块。`--verify-global` 只读检查策略和六份文档。`--rollback-global` 只在内容未漂移时移除该框架拥有的文档和标记区块；它不会修改技能、插件、模型、MCP、凭据或项目。

Codex 会在本地宿主进程启动时载入全局 Hook。`--install-global` 成功只证明磁盘上的配置和 runtime 已更新；必须完整重启 Codex 本地宿主进程后，新 Hook 才会激活。重启前即使新建任务也可能继续使用宿主缓存；新建任务不会刷新宿主 Hook，不能把它当作刷新边界。安装器的 JSON 输出会返回 `activation.status=restart_required` 和 `activation.scope=codex_host_process`。

受管 `hooks.json` 若只剩规范模板中完全一致的事件子集，安装器可补回缺失的受管事件；任何额外事件、matcher 或命令仍按外来漂移拒绝覆盖。

Harness 初始化故障时，Hook 只允许受控的只读诊断命令，并在拒绝原因中返回 `stage`、`code`、runtime/manifest 路径和恢复命令。先执行其中的 runtime 校验；校验失败后只能从权威框架源重新安装，不得直接维护安装副本：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-runtime.mjs" --verify --runtime-root "$HOME/.agents/leon-engineering/runtime"
```

本地 Claude 插件已经安装时，`claude plugin install` 只会报告“已安装”，不会刷新缓存版本。框架源码的插件版本升级后，应使用下面命令，并在现有 Claude Code 会话中重启后才会生效：

```bash
claude plugin update leon-engineering@leon-local --scope user
claude plugin list
```

技能安装与全局文档安装是独立操作。不要用全局框架命令代替目标项目的测试、lint、构建、浏览器检查或平台验证。实际运行过的命令和结果才可作为交付证据。

## 已登记 verifier 的观察执行

Harness 初始化或刷新 Agent Map 时会写入机器可读的 verifier 清单和稳定 verifier ID。只对清单中已知、非交互的 verifier 使用受管执行入口；未知命令继续使用原生 `exec_command`：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-run.mjs" --project /absolute/project --task-id task-id --verifier-id verifier-test-0123456789ab
node "$HOME/.agents/leon-engineering/runtime/harness-run.mjs" --project /absolute/project --task-id task-id --read-observation observation-0123456789abcdef01234567
```

Codex 的 patch→verify 仍使用现有 `functions.exec` 顺序调用：先执行 `apply_patch`，确认补丁成功后才调用 `harness-run.mjs` 运行 verifier；补丁失败不得启动 verifier。该集成不新增工具 schema，也不把任意命令塞入观察层。

完整 stdout/stderr 以 `0600` 留在 `.ai/harness/logs/<task-id>/`，路径穿越和符号链接会被拒绝，日志不会自动删除。普通调用最多返回 4 KiB，显式 `wideReceipt: true` 最多 8 KiB；超限时保留头、尾、错误上下文、状态、退出码、超时原因、SHA-256和日志引用。疑似秘密永不进入回执或回查，主归档失败则落到持久本地 fallback。`observation_recorded` / `observation_recalled` 指标不保存命令、日志或输出。

对用户指定的陌生项目，可从源仓库运行以下只读命令：

```bash
node scripts/profile-project.mjs --project /absolute/project --format markdown
```

它只检查固定的指令、清单、CI 和平台路径，输出的命令均标为 `candidate`，不会执行。只有用户针对该项目明确授权后，才可加入 `--write-profile` 创建 `.ai/project-profile.json`；已有档案还需要 `--replace-profile` 才会更新。安装全局框架本身不会调用该命令或扫描任何项目。

对已启用强制 Harness 的目标项目，Agent 自动开始新任务；用户不需要先运行命令。窄小改不带 delivery flag，只有完整交付加入 `--delivery-required`：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-session.mjs" --start --new-task --project /absolute/project --host codex --session-id opaque-task-key --task-id task-id --goal "目标" --acceptance "验收标准"
node "$HOME/.agents/leon-engineering/runtime/harness-session.mjs" --start --new-task --project /absolute/project --host codex --session-id opaque-task-key --task-id task-id --goal "目标" --acceptance "验收标准" --delivery-required
```

会话键包含宿主，Claude 与 Codex 即使收到相同 opaque session ID 也不会争用文件。若 Hook 报告 Harness 初始化失败，先执行下述受管 runtime 自检；该命令属于允许的只读恢复诊断。其他写入与无法证明只读的操作保持拒绝，stderr 的结构化诊断不回显项目路径、命令或 session ID：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-runtime.mjs" --verify
```

安装副本自检通过清单回指权威源并校验两侧内容；从权威仓库运行 `--verify-global` 时也会比较源码，能够识别陈旧安装。失败输出只提供阶段、稳定错误码、runtime/manifest 路径和恢复建议。恢复期间只有 `pwd`、配置/指令读取、`rg`/只读 `sed`、Git 只读命令和上述自检可放行；修改类与无法证明只读的命令仍拒绝。若自检失败，从 `leon-engineering` 权威源重新运行全局安装器后再次校验，不要手工修改安装副本。

完成任务后先运行验证，再记录实测结果。窄小改运行普通交付硬门 `harness-enforce`；只有完整交付使用 `--require-delivery`，它读取真实远端 receipt：

```bash
node "$HOME/.agents/leon-engineering/runtime/harness-enforce.mjs" --project /absolute/project --task-id task-id
node "$HOME/.agents/leon-engineering/runtime/harness-enforce.mjs" --project /absolute/project --task-id task-id --require-delivery
```

明确发布或高风险 Git 任务由交付控制器管理；窄小改不得启动下列发布链。`start` 返回功能 worktree，`prepare` 创建集成 worktree，验证后 `publish`，只在状态变化、超时或需要操作时查询 CI，最后 `cleanup`：

```bash
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --start --project /absolute/project --task-id task-id --slug short-slug
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --prepare --project /absolute/project --task-id task-id
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --publish --project /absolute/project --task-id task-id --verification-command "实际命令" --verification-status passed --verification-duration-seconds 12
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --status --project /absolute/project --task-id task-id
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --cleanup --project /absolute/project --task-id task-id
```

远端在发布前推进时，再次运行 `--prepare`，并在新的集成 worktree 重新验证。CI 修复提交使用 `--publish --repair`，最多三轮；之后只有控制器的独占 tip 检查和回滚后验证均通过时才能 `--rollback`。控制器禁止 force-push、脏 worktree 强删和未归并提交删除。完整协议见 `docs/iteration-delivery.md`。

要查看该项目已记录的交付指标，运行只读评估；它不会创建文件、执行账本内命令或扫描其他项目：

```bash
node scripts/harness-evaluate.mjs --project /absolute/project --all --format json
node scripts/harness-evaluate.mjs --project /absolute/project --all --format markdown
node scripts/harness-evaluate.mjs --project /absolute/project --task-id task-id --format markdown
node scripts/harness-evaluate.mjs --project /absolute/project --rebuild-index
```

`--task-id` 只读取指定普通 JSON 任务文件；`--all` 读取轻量索引并各读取一次 events/metrics。未索引或损坏证据返回部分报告、`complete: false` 和退出码 2。`--rebuild-index` 是显式写操作，逐文件超时且不下载 dataless 内容。不指定范围会失败。

最小充分验收由只读规划器生成。未知路径、契约、schema、依赖、CI、安全和桌面变更只能升级，不能手工降级：

```bash
node "$HOME/.agents/leon-engineering/runtime/verification-plan.mjs" --project /absolute/project --risk-tier local-only --change-kind internal --changed-file services/example.py
```

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
