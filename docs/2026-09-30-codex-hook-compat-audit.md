# Codex Hook 协议与来源审计

日期：2026-09-30。本报告区分仓库源码、已安装副本与当前宿主。下文“来源、配置和真实副本”至“更新预览”保存授权前的故障快照；授权后的当前磁盘状态见文末更新记录。

## 工作现场与版本

- 隔离副本：`/Users/leon/Documents/ChatGPT/leon-engineering/goal-audit`，`codex/role-convergence`，基线 `5f0ddd1a0b09ab4581d9aa2a29967cf89025804f`。上一轮六文件文档改动保持未提交，本轮在同一安全副本中增量修改。
- 当前桌面应用：`26.924.22138` / build `11645`（应用更新查询及 bundle Info.plist）。当前进程使用 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`；该 bundle 文件报告 `codex-cli 0.158.0-alpha.2.1`。终端 `codex` 为 `0.154.0`，不能代表桌面后端；运行中进程自身未提供独立协议版本查询。`codex app-server daemon version` 因本机无 daemon control socket 未取得后端握手版本。
- 对照文档：[Codex Hooks](https://learn.chatgpt.com/docs/hooks) 当前页面说明：PreToolUse 的普通继续可退出 0 且无输出，`deny` 可阻止；`allow` 仅与真实 `updatedInput` 重写配合；`ask` 尚不支持；PostToolUse 可在工具非零退出后运行。该页面为最新契约，不能替代本机版本的实际加载验证；本机已观察到 `deny` 阻止与旧 `allow` 报错。

## 来源、配置和真实副本

| 来源 | 配置与状态 | 处理器及职责 | 已安装脚本 SHA-256 |
| --- | --- | --- | --- |
| User | `/Users/leon/.codex/hooks.json`；Pre/Post 均有受信任记录，未标禁用；matcher `^(Bash|apply_patch|Edit|Write)$`，同步 timeout 3 秒 | `/Users/leon/.agents/leon-engineering/runtime/harness-hook.mjs --phase pre/post --host codex`；任务开始、`policy_decision`、`tool_completed` | `c743053fa3f1784852cf44c385dae549f660f9ffff985364258980e6f0f83db2` |
| Plugin Pre guard | `leon-engineering@leon-local` 0.19.3 的 `hooks/hooks.json`；受信任，未标禁用；matcher `Bash|Edit|Write|MultiEdit`，timeout 2 秒 | `node "$CLAUDE_PLUGIN_ROOT/scripts/guard.mjs"`；权限策略。Codex 同时设置兼容的 `CLAUDE_PLUGIN_ROOT` 与原生 `PLUGIN_ROOT` | `2693bb579b86472a57775c2235824c0cfd737537a72dc8e8b7a28a711a44e840` |
| Plugin Pre Harness | 同一 matcher、受信任且未标禁用 | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-hook.mjs" --phase pre`；旧副本在 Codex 下默认 `host=claude`，与 User Pre 重复登记 | `c743053fa3f1784852cf44c385dae549f660f9ffff985364258980e6f0f83db2` |
| Plugin Post Harness | 同一插件配置；该单个处理器在 `config.toml` 中 `enabled=false`；配置写有 `async=true`，不能据此宣称运行过异步处理 | `--phase post`；本机未启用，且 User Post 已承担账本记录 | 同上 |
| Project | 当前会话根目录与隔离副本均无 `.codex/hooks.json` 或 `.codex/config.toml` | 本轮无项目级处理器 | 不适用 |

Plugin 实际副本位于 `/Users/leon/.codex/plugins/cache/leon-local/leon-engineering/0.19.3/`，manifest ID/版本为 `leon-engineering` / `0.19.3`。User runtime manifest 记载来源 `/Users/leon/Developer/claude-engineering`、提交 `fcc04b5`；安装目录与本轮隔离副本没有同步。`adapters/codex/hooks.json` 是 User adapter 的模板，当前 `/Users/leon/.codex/hooks.json` 与模板的两个 phase、host 和 matcher 相符。项目配置无额外 Hook。

本机 CLI 的只读 `codex plugin marketplace list --json` 与 `codex plugin list --marketplace leon-local --json` 进一步确认：`leon-local` 的实际本地来源是 `/Users/leon/Developer/claude-engineering`，`leon-engineering@leon-local` 0.19.3 已安装且插件整体 `enabled=true`。隔离副本不是当前 marketplace 来源；直接对现有来源运行插件添加命令不会拾取本轮未归入权威源码的修复。CLI 列表只证明插件登记/启用，具体 Hook 是否运行仍以上述信任配置及当前事件为准。

## 故障证据链

1. 用户报告的宿主错误为 `PreToolUse hook returned unsupported permissionDecision:allow`。系统日志的同字符串检索未取得独立失败条目，因此原始错误仍以用户报告为起点。
2. 对已安装 Plugin `guard.mjs` 的脱敏进程输入，普通 `Bash` 返回 exit 0 和 `PreToolUse permissionDecision:allow`，需确认输入返回 `ask`，拒绝输入返回 `deny`；均无 stderr。一次含合成危险命令文本的当前工具调用被正在运行的 Hook 以 guard 独有的拒绝理由阻止，证明 Plugin guard 在当前宿主实际生效。
3. 对已安装 User runtime `harness-hook.mjs --phase pre --host codex` 的缺失会话 ID + `pwd` 输入，得到 exit 0、`PreToolUse permissionDecision:allow` 和脱敏 `initialization_failed` stderr。因此降级只读分支也可产生同一协议错误。
4. 当前会话的 User Harness 事件流位于会话根目录的 Git common 私有目录，近 100 条事件中约有 Codex `policy_decision` 34、Codex `tool_completed` 33、错误宿主标签的 Claude `policy_decision` 33。Plugin Pre 与 User Pre 在同一工具调用附近形成重复记录；Plugin Post 关闭时 User Post 仍在记录。一次受控 exit 7 的工具返回后也有 Codex `tool_completed`，没有 `verificationStatus` 字段。
5. `harness-enforce.mjs` 要求单独的 `verification_completed` 及最新 `completed/passed` outcome。`tool_completed` 只代表工具已返回；Hook 自身运行、工具退出成功、项目验收通过是三个不同状态。

## 源码修复与语义

- `scripts/guard.mjs` 保留 `decide()` 的 Claude 策略接口。在 Codex Plugin 环境以官方 `PLUGIN_ROOT` 区分宿主：普通 `allow` 输出空串，保留原生审批；`deny` 输出当前协议支持的阻止格式；内部 `ask` 保守编码为 `deny` 并说明人工确认路径，不借用不会为所有命令触发的 `PermissionRequest`。缺失/畸形输入 fail closed，错误日志为脱敏稳定码。
- Codex `apply_patch` 实际使用 `tool_input.command`。guard 只读取补丁文件头的目标路径，让既有密钥路径与 CI 配置保护继续生效；无可识别目标时阻止。未修改宿主沙箱或审批设置。
- `scripts/harness-hook.mjs` 对 Codex 降级只读不再输出不受支持的 `allow`，保留 stderr 诊断；降级写入/未知操作继续 `deny`。畸形 Post 输入不再误发 PreToolUse 事件。无显式 `--host` 且存在 Codex `PLUGIN_ROOT` 的 Plugin Harness 处理器读取完输入后不再登记第二份事件；显式 `--host codex` 的 User adapter 仍记录，Claude Plugin 旧行为仍记录。Codex 仅安装 Plugin、缺少有效 User adapter 时不会有 Harness 账本，因此受管安装及实机验收必须确认 User 路径启用且可信，不能用 Plugin 脚本跳过的 exit 0 冒充记录成功。

## 验证与安装边界

进程级红灯：新增测试在修复前复现普通 `allow`、内部 `ask`、降级 `allow`、错误事件类型和双宿主重复登记；补丁路径合同也先因空 stdout 失败。修复后 `guard.test.mjs` 与 `harness-hook.test.mjs` 的进程级测试 32/32 通过，覆盖普通、deny、ask、畸形输入、失败工具返回、Codex 单路登记与 Claude 兼容。受影响的 guard/Hook/Codex adapter/Claude adapter/runtime/catalog/enforce 固定合同曾以 100/100 通过；之后根据 diff 审阅补了畸形 Post 的结构化诊断断言，并修复它暴露的未定义变量。最终代码/测试状态的 `node --test tests/*.test.mjs` 为 275/275 passed、0 failed、0 skipped，70.1 秒；运行时合同和 `tests/fixtures/minimal-project/` 均包含在内。临时 Codex adapter 在 `/private/tmp` 独立目标安装及 `--verify-global` 均 exit 0、零漂移、runtime 哈希一致，报告 `restart_required`，临时目标已移除。真实桌面宿主需在受管安装及重启/信任检查后另开小窗口验证。本轮不修改 `/Users/leon/.codex/` 配置、插件缓存、User runtime 或信任状态。

最终 12 文件 changed set 的 planner 给出 `full-delivery / L4` 与外部 `framework-ci` 门；本轮不发布，外部门未运行、不得记为通过。`node scripts/check-architecture-map.mjs --project .` 返回 `valid: true`、10 modules、111 references；`node scripts/project-constraints.mjs --project .` 带完整 12 个 `--changed-file` 返回零违反项；`git diff --check` 覆盖新增报告并通过。上述项目门与全量测试分别执行，未以 planner 自证正确。

更新预览：当前仓库候选 `guard.mjs` SHA-256 为 `6454e4d0db8364bf67cf7be212966ceb00051ae5a26f01d2b15e660f92b82bbb`，候选 `harness-hook.mjs` 为 `3ab430b4c5118dd1b1f6f34f9cde6c0d7a4ecac1178f534a5140947a24cf9d2f`；它们与上表的已安装哈希不同。最小目标是已定位 0.19.3 Plugin 包中的两个脚本，以及 User runtime 的 `harness-hook.mjs` 与其 manifest；`hooks/hooks.json`、User `hooks.json` 的 matcher/命令本轮不变。隔离副本仍有未提交改动，正式分发前须纳入受管权威源码并生成可追踪的新包，不能把旧 0.19.3 缓存手改为“新版本”。更新前先对插件包、User runtime/manifest、User hooks 配置做带 SHA-256 的定点备份，再通过受管分发/安装入口升级和校验；发现漂移即停止。若新插件定义被标为待复审，需用户按 `/hooks` 审阅；宿主缓存需重启后才可证明激活。回滚以未改写的备份及受管 manifest 核验为准，不删除历史账本。

结论：保留 User PostToolUse，不新增或默认启用 Plugin PostToolUse。当前源码修复不等于已安装版本更新，更不等于真实 Desktop 验证。没有证据把此故障归因为六小时任务的全部耗时；Token/额度影响未测量。

## 授权后的受管更新

- `leon-local` 权威来源 `/Users/leon/Developer/claude-engineering` 在干净 `main` / `fcc04b5` 上应用了仅含 `scripts/guard.mjs`、`scripts/harness-hook.mjs`、两份对应合同测试和 `docs/harness-v1.md` 的补丁。来源的聚焦合同 101/101、全量合同 228/228 通过（71.8 秒），`git diff --check` 通过；本地提交 `f665fa41bba14f72da0d06c1b74ed8df5bf4a9b0`，未 push/PR/发布。隔离副本中上一轮未提交的文档改动未转入此提交。
- 首次更新来源后，旧 User Hook 因 `harness-hook.mjs` 的源码哈希变化进入 `manifest_drift` fail closed；受管安装命令在 Hook 前被拦截。用户从系统 Terminal 建立 `/private/tmp/leon-harness-repair-8ZDfBTg7/runtime` 备份并运行受管 runtime 安装器；`--verify` 返回 `valid: true`、零漂移。源码提交后再次运行安装器，当前 runtime manifest 的 `sourceCommit` 为 `f665fa4`，`sourceRoot` 仍是权威来源，`--verify` 再次为零漂移。
- 插件包及配置备份位于私有的 `/private/tmp/leon-plugin-update-9TcB0tMJ/`，包含旧 0.19.3 插件包、`config.toml` 和 User `hooks.json`；备份中两个脚本哈希分别是 `2693bb57…`、`c743053f…`。执行官方 `codex plugin add leon-engineering@leon-local --json` 后，原插件 ID 仍安装且启用，版本字段仍是 `0.19.3`。缓存 `guard.mjs` 哈希现为 `6454e4d0…`，缓存及 User runtime `harness-hook.mjs` 均为 `3ab430b4…`，与权威源码一致；User `hooks.json` 与备份哈希一致。
- 更新后 `config.toml` 仍显示 User Pre/Post 受信任且未禁用，Plugin Pre 两个处理器受信任且未禁用，只有 Plugin Post `enabled=false`。直接执行已安装脚本的脱敏进程测试：普通 Codex guard exit 0 且 stdout 为空；需确认与拒绝输入均返回 `deny`；Plugin Harness 与 User Pre/Post 合并后只得到 `task_started`、`policy_decision`、`tool_completed` 三条 `host=codex` 事件，没有 `verification passed`。
- 授权更新后的旧宿主进程在 2026-09-30 04:56:40–04:56:47 UTC 的安全 `git status --short` 窗口中，只新增一条 Codex Pre 决策与一条 Codex Post 返回，没有旧 `host=claude` 重复登记。04:59:42–04:59:55 UTC 又在 `/private/tmp` 的隔离 fixture 上成功执行一次 `apply_patch`，核对文件内容后观察到恰好一条 `host=codex/tool=write` 的 Pre 和一条 Post 事件，没有 `verification passed`；fixture 随后移除并确认不存在。此时仍需重启后的宿主窗口，旧累计 Failed 数不作为本轮通过标准。
- 用户完全重启后，ChatGPT 主进程于 2026-09-30 13:17:28 本地时间启动，Codex 后端子进程于 13:17:37 启动。重启后配置仍显示 User Pre/Post 与 Plugin 两个 Pre 受信任且未禁用，Plugin Post 单独 `enabled=false`；安装脚本哈希和 User runtime 校验仍匹配。05:28:00–05:28:08 UTC 的 `git status` 和测试文件读取均 exit 0，账本各新增一条 `host=codex/tool=shell` 的 Pre 与 Post；05:29:48–05:30:00 UTC 的隔离 fixture `apply_patch` 成功，文件内容核对通过，账本新增一条 `host=codex/tool=write` 的 Pre 与 Post，fixture 随后移除。以上三个成功调用未出现 `host=claude` 重复项或模型可见协议错误。另有两条仅打印合成危险/需确认文本的命令在执行前分别被 `deny` 和“需人工确认”理由阻止，没有真实删除或推送。可观察窗口内为三组正常 Pre/Post、两次预期阻止、零次已见协议失败；未取得 Desktop Hook 浏览器的累计 Failed 数，不能宣称该 UI 计数下降或历史 Failed=80 归零。官方明确的状态查看入口是 CLI `/hooks`，它可复核配置/信任，但新 CLI 会话不等于此 Desktop 窗口。
- 用户随后手动启用截图所示的 Plugin PostToolUse；`config.toml` 中该处理器变为 `enabled=true`，User Post 仍受信任且未禁用。05:43:29–05:43:35 UTC 的安全 `git status` 返回成功，在超过 Plugin Post 配置的 2 秒窗口后，账本仍只有一条 `host=codex/tool=shell` 的 Pre 与一条 Post；没有新增 `host=claude` 或第二条 `tool_completed`。这与当前 Plugin Harness 在 Codex 下只消耗输入、不写账本的源码一致，但不能仅凭账本证明异步处理器本身成功运行。有效记录入口仍是 User Post；Plugin Post 无额外验收价值，建议恢复关闭以省去一次冗余处理器调用，不改变 User Post。

回滚预案：优先在权威来源局部撤销 `f665fa4`，用受管 runtime 安装器和 `codex plugin add` 重新分发，再重启并校验；若受管工具失败，保留的两个私有备份可用于定点恢复，不清理历史账本。任何回滚都须先核对当前 manifest、文件哈希与并发改动。远端 CI 和原生平台未运行；不能以本地 228/228 或上述宿主烟测代替外部门，也不能报告 Token/额度节省。
