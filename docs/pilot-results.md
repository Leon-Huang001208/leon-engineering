# Pilot results

**Date:** 2026-07-30

## Passed deterministic checks

- `claude plugin validate .claude-plugin/plugin.json` passed.
- The guard tests passed: destructive and credential actions deny; remote, dependency, and CI changes ask; normal local work allows.
- The audit test passed: events include only timestamp, lifecycle event, and tool name.
- A hook-shaped audit invocation created `/Users/leon/.claude/audit/events.jsonl` with mode `0600`; the recorded event contained no command, path, or token-derived text.
- The guard command emitted a valid `PreToolUse` allow response for `git status --short`.
- Both skill frontmatters parsed with the macOS Ruby YAML standard library and contain the required `name` and `description` fields.
- The plugin source uses small, locally committed changes; this document is updated after each pilot result.
- A complete, checksum-protected runtime snapshot exists at `/Users/leon/.claude/backups/engineering-framework-20260730-140935`.

## Runtime integration result: passed interactively

In disposable Git repositories, interactive Claude Code loaded `@leon-engineering:repo-explorer`. A `--bare` session that loaded only this plugin displayed both `leon-engineering` skills in its slash-command matcher: `agent-routing` and `skill-health`.

The guard command processed hook-shaped JSON and returned the expected decisions: `git status` and a routine source-file write allowed; `.env.local` denied; `git push` and `pip install` asked. This covers the same five pilot policy cases without exposing a real project to a write attempt.

Non-interactive `claude -p` requests still produced no output within 60 seconds, including the bare baseline. `claude auth status` reported a logged-in first-party OAuth session and direct HTTPS connectivity succeeded. Treat this as a separate CLI responsiveness issue, not as a framework activation blocker.

## Activation decision

`leon-engineering@leon-local` installed successfully with user scope and is enabled. `claude plugin details leon-engineering` reports two skills, two agents, and two hooks with an estimated always-on cost of 179 tokens.

The global policy is now active with medium default effort, a 160k compaction window, routine local engineering permissions, and explicit high-risk Bash denials. Retain the snapshot above until the two-week observation period has completed.

## Direct catalog expansion

**Date:** 2026-07-31

The user explicitly authorized advancing directly from the pilot to the complete initial catalog defined in the framework design. This adds five focused workflows (`project-bootstrap`, `feature-loop`, `bugfix-evidence`, `review-ship`, and `logging-observability`) and five bounded agents (`implementer`, `code-reviewer`, `security-reviewer`, `ci-triage`, and `docs-mapper`). It does not import or retire the broad legacy catalogs.

- `node --test tests/catalog.test.mjs tests/guard.test.mjs tests/audit.test.mjs` passed: 7 tests, 0 failures.
- `claude plugin validate .claude-plugin/plugin.json` passed and every JSON configuration parsed successfully.
- The catalog test confirms exactly seven skills and seven agents, explicit trigger/boundary metadata, no recursive delegation, worktree isolation for the implementer, and a non-production pilot scenario for every component.
- Source commit: `40b81e5 feat: expand engineering workflow catalog`.
- `claude plugin update leon-engineering@leon-local --scope user` updated the user-scope plugin from `0.1.0` to `0.2.0`. `claude plugin details leon-engineering@leon-local` reports seven skills, seven agents, and two hooks.

Claude Code must restart before the `0.2.0` catalog is loaded into a current session. The two-week audit observation remains useful for future tuning, but is no longer a prerequisite for this initial-catalog expansion.

## Fresh-process verification

**Date:** 2026-07-31

The installed cache at `/Users/leon/.claude/plugins/cache/leon-local/leon-engineering/0.2.0` passed all seven Node tests and manifest validation. `claude plugin details leon-engineering@leon-local` confirmed the installed `0.2.0` catalog has seven skills, seven agents, and two hooks.

A fresh non-interactive `repo-explorer` invocation against a disposable Git fixture did not return within approximately 60 seconds and was stopped. The fixture had no uncommitted changes. This reproduces the existing non-interactive CLI responsiveness issue; it does not demonstrate a catalog-loading failure and does not replace an interactive agent invocation after a Claude Code restart.

## Codex–Claude adapter validation

**Date:** 2026-07-31

- The source adapter passed `node --test tests/catalog.test.mjs tests/guard.test.mjs tests/audit.test.mjs tests/codex-adapter.test.mjs`: 11 tests, 0 failures. `claude plugin validate .claude-plugin/plugin.json` also passed.
- The Codex adapter installed all seven workflow directories to `/Users/leon/.codex/skills` with framework version `0.3.0` and source commit `cb35ffa`. Its manifest verification passed, the installed `agent-routing` reference contains the Codex role templates, and pre-existing `pdf` and `playwright` skills remained present.
- A fresh read-only `codex exec` request for `project-bootstrap` against a synthetic Git fixture produced no model answer after more than two minutes and was stopped. The fixture remained clean. This is a non-interactive Codex CLI responsiveness limitation, not a successful skill-discovery result.
- Native Codex subagent pilots did provide direct role evidence in the same synthetic fixture: `repo-explorer` returned the required repository findings with no parent diff; `implementer` changed only its dedicated child worktree, first reproduced the missing-default failure, then passed `node --test test/greet.test.js` with 2 tests. The parent checkout remained clean.
- `claude plugin update leon-engineering@leon-local --scope user` updated the user plugin from `0.2.0` to `0.3.0`. It was then enabled at user scope. `claude plugin details leon-engineering@leon-local` reports seven skills, seven named agents, and two hooks; the installed cache contains and validates the shared Codex role-template reference.

Restart Claude Code before using the updated plugin in an existing session. Codex global skills are already installed; a new Codex task sees the installed catalog, while the recorded non-interactive CLI limitation remains separate from its desktop-agent validation.

## Global project framework activation

**Date:** 2026-07-31

- `node --test tests/*.test.mjs` passed: 15 tests, 0 failures. `node --check scripts/install-codex-adapter.mjs`, `claude plugin validate .claude-plugin/plugin.json`, JSON manifest parsing, and `git diff --check` also passed before activation.
- Source commit `08fe70d feat: add global project framework` was installed. The source now owns a bounded policy block, six global workflow documents, and a separate global-framework manifest; the existing seven-skill manifest remains independent.
- The prior `/Users/leon/.codex/AGENTS.md` was copied to `/Users/leon/.codex/backups/global-project-framework-20260731/AGENTS.md.before` before installation. The installer preserved text outside its marker block.
- `node scripts/install-codex-adapter.mjs --install-global --codex-home /Users/leon/.codex` installed `GETTING_STARTED.md`, `STRUCTURE.md`, `COMMANDS_GUIDE.md`, `SKILLS_GUIDE.md`, `AGENTS_GUIDE.md`, and `SETTINGS_GUIDE.md`. Its immediate `--verify-global` result was `valid: true` with no drift.
- The standard skill adapter then installed and verified all seven shared workflows at framework version `0.4.0`; `--verify --target /Users/leon/.codex/skills` also returned `valid: true` with no drift. Existing non-framework skills remain outside the adapter's ownership.
- No repository below `/Users/leon/Desktop/Projects` was scanned, edited, committed, or pushed by this activation. Project-level instructions remain the higher-priority source of truth for every future task.

## Project adapter activation

**Date:** 2026-07-31

- The source profile-generator tests covered bounded evidence discovery, default read-only behavior, explicit persistence, overwrite refusal, unsafe-root rejection, malformed `package.json`, and CLI output. `node --test tests/*.test.mjs` passed: 21 tests, 0 failures.
- `node --check scripts/profile-project.mjs`, `git diff --check`, `claude plugin validate .claude-plugin/plugin.json`, and JSON parsing for both adapter manifests and the profile schema passed before activation.
- Source commit `48e5e97 docs: guide project adapter workflow` was installed as framework version `0.5.0`. The adapter now owns eight shared skills, including `project-adapter`; the global-document and skill manifests verified with `valid: true` and no drift.
- `project-adapter` was not run against any real project during this activation. No project profile, `.ai/` directory, project source, project configuration, repository history, remote, or CI configuration was created or changed.
- Future tasks may run the generator only for a user-selected project. Its normal mode is read-only; writing `.ai/project-profile.json` remains a separate explicit authorization and replacement remains opt-in.

## 高吞吐全局交付协议试运行

**日期：**2026-08-03

- 源码分支 `codex/high-throughput-delivery` 已完成源码验证：`node --test tests/*.test.mjs` 为 37/37 通过；`node --check scripts/install-codex-adapter.mjs`、`node --check scripts/install-claude-adapter.mjs`、`claude plugin validate .claude-plugin/plugin.json` 与 `git diff --check` 均通过。
- 在实际全局目录安装前，原文件已备份至 `/Users/leon/.codex/backups/high-throughput-20260803/AGENTS.md.before` 与 `/Users/leon/.codex/backups/high-throughput-20260803/CLAUDE.md.before`。随后安装并校验 Codex 全局策略、八个共享工作流和 Claude 受管策略；三项校验均返回 `valid: true`、零漂移，受管清单版本均为 `0.6.0`。
- 快路径夹具位于 `/tmp/leon-high-throughput-pilot-20260803`：主会话只改动 `src/greet.js` 与 `test/greet.test.js`，为已点名函数补充默认值 `World`，直接执行 `node --test test/greet.test.js`，结果 2/2 通过，并以 `git diff --check` 检查。该路径没有创建计划、代理或 worktree；改动随后作为夹具提交，父检出保持干净。
- 只读调研夹具：`repo-explorer` 仅读取同一夹具的 `README.md`、`src/greet.js` 与 `test/greet.test.js`，正确识别函数入口、默认值和 Node 内置测试入口；其未执行测试，明确标记该限制。之后以父检出的 `git diff --exit-code` 与空 `git status --short` 独立确认没有改动。
- 隔离实现夹具位于 `/tmp/leon-high-throughput-implementer-20260803`：`implementer` 只改动独立 worktree 中的 `src/greet.js` 与 `test/greet.test.js`，先复现空格输入返回 `Hello,  Leon ` 的失败，再以 `name.trim()` 完成最小修复。独立复核 `node --test test/greet.test.js` 为 3/3 通过、`git diff --check` 通过；父检出仍无未提交改动，执行者没有提交。
- 实施分支已快进合并至主分支。随后 `claude plugin update leon-engineering@leon-local --scope user` 已将用户级插件从 `0.3.0` 更新到 `0.6.0`；启用命令确认该插件原本已在用户范围启用。`claude plugin details leon-engineering@leon-local` 确认当前目录包含八个共享工作流、七个 Claude 命名代理和两个 hooks。已打开的 Claude Code 会话必须重启后才会载入新版本。
- 非交互式 `codex exec` 与 `claude -p` 未返回的既有响应性限制，继续只作为限制记录，不作为加载或试运行成功的证据。

## 已安装能力路由修正

**日期：**2026-08-03

- 用户指出“直接回答框架缺口、没有先查现有能力、后续新会话会丢失约定”的问题后，已将修正写入两端受管策略、Codex 快速开始与技能指南，以及共享 `agent-routing` 工作流；不再仅保留在对话中。
- 新规则要求：选择执行路径前先匹配已安装的 skill、agent 和工具；命中即按触发条件使用，不命中才用通用能力直做。检查本机已有能力属于快路径，不创建计划、代理或 worktree；发现外部候选不等于安装，外部安装仍需要来源/权限审查和用户明确同意。
- 规则同时要求：用户授权的可复用框架修正必须同步更新受管源、回归测试和安装副本，并在交付中提供验证证据；未获授权时只记录建议，不能擅自改变全局行为。
- 回归测试新增两项，完整源码测试 `node --test tests/*.test.mjs` 为 39/39 通过；两个安装器语法检查、插件清单校验与 `git diff --check` 均通过。
- 主分支提交 `104d075 feat: route work through installed capabilities` 已安装。Codex 全局策略、八个共享 skills 和 Claude 受管策略均验证为 `valid: true`、零漂移；Claude 用户插件已从 `0.6.0` 更新为 `0.6.1`，详情确认 8 个 skills、7 个 agents 和 2 个 hooks。已打开的 Claude Code 会话必须重启后才会载入新版本。

## 主动框架学习激活

**日期：**2026-08-03

- 用户明确授权：面对跨项目可复用的执行错误和经验，框架不再等待再次指出；有实际证据的低风险修正自动完成“受管源 → 回归测试 → 安装副本 → 记录”，高风险或影响面不明的修正仍须明确确认。
- 新增 `docs/framework-learning.md` 定义触发条件、自动推广、升级确认和非敏感记录格式；项目特定事实、用户内容、秘密、路径和一次性偏好不进入全局学习。
- 新增一项目录契约测试，并将原“用户授权后持久化”契约升级为主动持久化契约。完整源码验证 `node --test tests/*.test.mjs` 为 40/40 通过；两个安装器语法检查、插件清单校验和 `git diff --check` 均通过。
- 主分支提交 `9c3839c feat: proactively promote reusable framework learning` 已安装。Codex 全局策略、八个共享 skills 和 Claude 受管策略均验证为 `valid: true`、零漂移；Claude 用户插件已从 `0.6.1` 更新为 `0.6.2`，详情确认 8 个 skills、7 个 agents 和 2 个 hooks。已打开的 Claude Code 会话必须重启后才会载入新版本。

## Claude 全量目录审查与治理激活

**日期：**2026-08-03

- 对 `~/.claude` 完成只读全量审查：54 个 skill 入口中 52 个与 Codex/Claude 共用技能源逐文件一致；235 个 agent 文件中 230 个元数据完整、2 个 YAML 无效、3 个为说明文件；用户级 rules 有 99 个 Markdown 文件，`ecc` 包含 55 个嵌套 skill。
- 发现并处理的活动冲突包括：旧 rules 的“agent 默认、默认规划、任何不确定都阻塞提问、每次错误写固定绝对路径记忆”与快路径和主动学习冲突；本地 `planner`、`code-reviewer`、`security-reviewer` 与规范插件角色同名但边界更宽。
- 已完整备份至 `/Users/leon/.claude/backups/catalog-governance-20260803/`，随后把 99 个旧 rules、`ecc`、`zq` 与 8 个冲突/无效/说明 agent 可恢复地移动到 `/Users/leon/.claude/legacy/catalog-governance-20260803/`；没有删除文件。剩余 52 个已验证共用源的 skill 和 227 个 Claude 专用候选 agent 保持原位，但只有共享目录已映射的能力可成为跨宿主默认。
- 新增 `docs/shared-capability-catalog.md` 记录逐项裁决：8 个 `leon-engineering` 核心工作流、52 个同源可发现 skill 和 7 个规范职责代理可跨宿主路由；`ecc`、`zq`、来源或权限不明的行业 persona 不自动推广。
- 源码验证 `node --test tests/*.test.mjs` 为 41/41 通过，两个安装器语法检查、插件清单校验和 `git diff --check` 均通过。主分支提交 `0c0ac73 feat: govern shared Claude capability catalog` 已安装；Codex 和 Claude 受管策略均为 `valid: true`、零漂移。Claude 用户插件已从 `0.6.2` 更新为 `0.6.3` 并确认启用，详情为 8 个 skills、7 个 agents 和 2 个 hooks；现有 Claude Code 会话需要重启。

## CC-Switch 能力登记纠偏

**日期：**2026-08-03

- 触发信号：用户发现 CC-Switch 显示 Claude 58、Codex 28，与此前“52 个同源可发现 skill”的审查结论混淆。排查确认前者是 CC-Switch 数据库的启用标记，不是直接目录或插件运行时能力的统一计数。
- 可复用结论：共享内容等价、直接目录存在、插件运行时加载和第三方管理器登记是四个不同口径，必须以可执行同步检查统一第三方管理器的启用标记，不能只在对话中解释。
- 实际修正：对 CC-Switch 数据库先创建可恢复快照，再下线已迁移 `zq` 的 Claude 标记、下线 Codex 缺失的 `data-connector-development` 标记，并登记 Claude 插件实际启用的 `feature-loop`、`project-adapter`、`project-bootstrap`。结果为 Claude 60、Codex 27；没有删除任何 skill 文件。
- 受管源新增 `scripts/sync-cc-switch-skills.mjs`：默认只读审计，`--apply` 才写入，写入前自动备份，且只更新启用标记。新增回归测试覆盖目录、插件和下线能力同时存在时的期望结果。

## Harness v1 激活

**日期：**2026-08-03

- 新增 `project-harness` 作为第 9 个共享核心 workflow。它为用户明确选择的项目和任务生成只读预览，只有 `--write-harness` 才创建本地 Agent Map、任务账本和 JSONL 指标；`--record-outcome` 只记录执行者已观察到的验证状态，绝不执行其声明的命令。
- 自动化夹具验证了：默认不创建 `.ai/harness/`；显式写入只创建 `agent-map.md`、单任务记录和指标事件；重复写入被拒绝；结果记录不会执行声明命令；符号链接目录被拒绝，不能写出项目根目录。
- 主分支提交 `7e990f7 feat: add project delivery harness` 的完整测试为 47/47 通过；`node --check scripts/harness-project.mjs`、`node --check scripts/install-codex-adapter.mjs`、`node --check scripts/sync-cc-switch-skills.mjs`、插件清单校验和 `git diff --check` 均通过。
- 已安装 Codex 全局文档与 9 个受管 skills，三个适配器校验均返回 `valid: true`、零漂移。Claude 用户级插件已从 `0.6.3` 更新到 `0.7.0` 并启用；CC-Switch 自动登记新 workflow，当前统计为 Claude 61、Codex 28，并已生成可恢复数据库备份。
- 本次仅使用临时夹具验证 Harness 行为；没有向任意真实项目写入 `.ai/harness/`。实际项目的持久化必须仍由用户对该项目明确授权。

## Harness 交付评估闭环激活

**日期：**2026-08-03

- 主分支提交 `efd400d feat: add harness delivery evaluation` 新增只读 `harness-evaluate.mjs`。它以最后一条任务结果计算完成通过数、一次通过率、澄清/返工均值、验证耗时覆盖率与阻塞分类；不执行账本命令、不写项目文件，并拒绝符号链接任务目录。新结果记录强制要求实际测得的验证秒数；`blocked` 结果还强制要求标准化阻塞分类。历史记录仍可读，但缺字段会显示为覆盖率不足。
- 实施前后的红/绿测试均有记录：评估器初始因模块不存在失败，指标字段初始因未被保留及 CLI 参数未识别失败；实现后目标测试通过。完整验证 `node --test tests/*.test.mjs` 为 50/50 通过；四个脚本语法检查、插件清单校验与 `git diff --check` 均通过。更新后的 `project-harness` Skill 压力复核确认：先只读评估并报告样本/覆盖率，不执行账本命令，不猜测回填历史字段。
- Codex 受管文档和 9 个 skills 已重新安装，两个 Codex 校验均为 `valid: true`、零漂移，清单版本为 `0.8.0`、源提交为 `efd400d`。Claude 受管策略也验证为 `valid: true`、零漂移。CC-Switch 同步后为 Claude 61、Codex 28，未产生数据库变更。
- 激活中发现：对已安装插件执行 `claude plugin install` 只返回“already installed”，仍显示 0.7.0；这不等于已更新。改用 `claude plugin update leon-engineering@leon-local --scope user` 后，用户级插件实际从 0.7.0 更新到 0.8.0；`claude plugin details` 确认 9 个 skills、7 个 agents 和 2 个 hooks。该修正已写入受管命令指南。现有 Claude Code 会话仍需重启后加载新版本。
- 已对用户明确选择的 AlphaFoundry 运行只读 Markdown 评估：仅有 1 条历史 Harness 初始化结果，显示一次通过率 100%，但验证耗时覆盖率为 0%、无阻塞分类。因此它不是业务交付速度结论；后续真实任务必须补齐新字段并积累跨项目样本。该命令未写入 AlphaFoundry。

## P1 项目机械约束激活

**日期：**2026-08-03

- 新增第十个共享 workflow `project-constraints`，以及只读 `project-constraints.mjs`。项目以受跟踪 JSON 声明必需文件、源码改动的文档联动、内容模式、禁止依赖模式和 CI 工作流文本。检查器只接收调用方显式给出的相对变更路径，不执行 Git、测试、构建或项目命令；有违反时输出 JSON 并以退出码 1 阻断。路径越界、未知配置键和符号链接均被拒绝。
- 为使 GitHub CI 不依赖开发机路径，新增 `install-project-constraints.mjs`。它默认仅预览；明确 `--write` 后才原子复制检查器到项目 `.agents/project-constraints.mjs`，拒绝未经 `--replace` 的覆盖和所有符号链接。测试先行记录了模块缺失、目录缺失、未知配置键和未识别依赖规则的失败，再完成实现。
- 框架完整验证为 `node --test tests/*.test.mjs` 57/57 通过；约束检查器、安装器、适配器和 CC-Switch 脚本语法检查，插件清单校验及 `git diff --check` 均通过。Skill 压力复核确认：默认只读、只接收显式变更路径、项目配置/CI 写入须授权、静态通过不等于 Windows 或运行时验证。
- 主分支提交 `f2cafd6 feat: enforce project mechanical constraints` 和 `a794baa feat: check architecture dependency constraints` 已安装。Codex 全局文档与 10 个受管 skills、Claude 受管策略均验证为零漂移；Claude 用户插件已从 0.8.0 更新至 0.9.0 并启用。CC-Switch 已登记 `project-constraints`，统计为 Claude 62、Codex 29，并生成可恢复数据库备份。
- AlphaFoundry 在隔离分支 `codex/project-constraints-p1` 中新增并合并 `ae3af82 ci: enforce AlphaFoundry project constraints`：`.agents/project-constraints.json`、受管检查器副本及轻量 `.github/workflows/project-constraints.yml`。该 workflow 在 PR 和 master 推送中以 Ubuntu 运行静态门禁，同时要求现有桌面 workflow 持续具备 Windows sidecar 健康检查和 `setup_required` 证据。实际本地检查显示：空变更与 `services/wind_realtime_workbook.py` 加 `docs/CHANGELOG.md` 的合规变更通过；`services/configuration_catalog.py` 被正确阻断，原因是缺少 `get_logger` 与 `except`。工作流 YAML 已解析，GitHub Actions runner 尚未实际运行，因此未宣称 CI 或 Windows 验证已通过。

## Harness P2 控制平面激活

**日期：**2026-08-03

- 新增 `harness-control.mjs`，用于已初始化 Harness 的单项目任务 DAG、状态机、显式重试和 worktree 恢复定位。默认任务计划命令只输出预览；只有 `--write-control-plane` 才创建 `.ai/harness/control-plane.json`。状态转换、重试和登记都是独立显式命令，并要求真实理由。
- 临时项目验证覆盖：依赖任务仅在上游完成后解锁；未知依赖和环被拒绝；失败任务仅能通过 `--retry` 增加尝试次数后恢复；worktree 只保存绝对路径、分支和基准提交；符号链接 Harness 被拒绝；CLI 的预览零写入。脚本源码也被回归测试锁定为不导入子进程 API，因此不会运行 Git、测试、构建或任务命令。
- Skill 压力基线与复核均已执行。无 P2 指引时，agent 已拒绝擅自创建 worktree、重试或运行命令，但缺少固定恢复入口；更新后，agent 先给出只读 DAG 预览，明确每一项写入、重试和 worktree 登记的命令边界，并保留“不自动执行”的限制。
- 完整框架验证为 `node --test tests/*.test.mjs` 61/61 通过；`harness-control`、Harness、评估器、两端适配器与 CC-Switch 脚本的语法检查通过；插件 JSON 已解析，`git diff --check` 通过。此证据来自临时夹具和本地框架测试，未创建真实项目控制文件，也未触发 GitHub 或 Windows runner。
