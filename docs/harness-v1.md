# Harness v1：项目级持续交付状态

Harness v1 解决“新会话忘记上下文、完成标准不稳定、无法衡量返工”的基础问题。它不接管项目管理系统，不启动常驻 Agent，也不替代项目自己的 `AGENTS.md`、CI 或测试。

## 结构

对用户明确选择的项目和任务，`scripts/harness-project.mjs` 可生成一套逻辑 Harness 目录。Git 仓库把该目录放在 Git common dir 的 `leon-engineering/harness/` 下，因此主 checkout 和所有 linked worktree 共用同一账本，删除普通功能或集成 worktree 不会删除任务证据。非 Git 项目继续使用项目内 `.ai/harness/`。两类目录均使用 `0700`，其中的账本、索引、日志和清单使用 `0600`。

逻辑目录包含：

- `.ai/harness/agent-map.md`：从受限项目画像得出的指令、候选验证命令和 CI 入口；项目指令优先。
- `.ai/harness/tasks/<task-id>.json`：目标、验收标准、当前状态和已记录的结果。
- `.ai/harness/metrics.jsonl`：任务创建与结果事件，用于统计澄清轮次、返工次数、验证状态、实测验证耗时和阻塞分类。
- `.ai/harness/events.jsonl`：只追加的跨宿主执行事件；只含任务 ID、宿主、事件类别和白名单状态，绝不含提示词、命令、路径、源代码、密钥或会话 ID。
- `.ai/harness/verifiers.json`：Agent Map 的机器可读 verifier 清单；每项包含稳定 verifier ID、命令、相对工作目录、来源、参数数组和非交互标记。
- `logs/<task-id>/`：`0600` 的完整 stdout/stderr 和 observation 元数据；拒绝符号链接与路径穿越，不自动删除。

默认命令只输出预览。`--write-harness` 是项目内写入的明确边界；已有 Harness 或同名任务不会被覆盖。`--record-outcome` 只保存执行者已经获得的证据，绝不执行命令、读取环境变量或访问网络。每条新结果都必须附带执行者实际测得的 `verificationDurationSeconds`；`blocked` 结果还必须附带标准化 `blockerCategory`。这些字段不是脚本估算出来的，也不能从聊天内容回填。

升级前若 Git 仓库已有项目内 `.ai/harness/`，运行时会拒绝创建第二套账本并提示迁移。先只读预览，再显式复制和逐文件校验；迁移成功仍保留旧目录，便于人工回滚：

```bash
node scripts/harness-storage.mjs --preview --project /absolute/project
node scripts/harness-storage.mjs --migrate --project /absolute/project
```

预览不写文件。迁移拒绝符号链接、不可读记录、路径逃逸和内容不同的同名任务；只有 staging 副本的逐文件 SHA-256 与汇总哈希全部复核后才切换到 Git-common 目录，并写入版本化 manifest 与 rollback map。旧目录不会自动删除。

完整交付档任务可在任务记录中声明 `delivery.required: true`。该字段由 `harness-session --delivery-required` 或项目命令的同名参数创建，用于要求最终硬门读取 Git common dir 中的交付 receipt；其他档位不声明该字段。

## 强制任务协议

用户为目标项目启用强制 Harness 后，所有会形成项目交付、改动或调研结论的新任务必须由 Agent 自动使用 `harness-session.mjs --start --new-task` 创建；任务延续时恢复同一不透明任务键。用户不需要手动运行该命令。纯聊天和未指定项目的问答不创建项目记录。

完成时必须先实际运行验证，再写入结果并运行 `harness-enforce.mjs --project <目录> --task-id <ID>`。只有完整交付档在启动时添加 `--delivery-required`，并在完成时添加 `--require-delivery`；该硬门除开始事件、最新 `completed/passed` 结果、验证命令、实测耗时和验证完成事件外，还实时检查 receipt 中的远端提交、CI、分支和 worktree 状态。它不运行记录的命令，也不执行 Git 写操作。Codex 与 Claude 都在本地工具边界通过 `PreToolUse`/`PostToolUse` Hook 自动建立或恢复会话并记录非敏感事件。会话文件按宿主与不透明 session ID 联合摘要隔离；旧同宿主文件可迁移恢复，旧异宿主文件保持不变。读取端接受结构兼容的 v1/v2 会话记录，并仍校验摘要键、宿主和对应任务；损坏或不匹配记录不会被静默信任。

初始化失败时，Hook 进入受限恢复模式：只有 `pwd`、配置/指令读取、`rg`、只读 `sed`、Git 只读命令和受管 runtime `--verify` 等明确 `diagnostic_read` 操作可继续；已知 `mutation` 和无法证明只读的 `unknown` 都拒绝。诊断只输出阶段、稳定错误码、受管 runtime/manifest 路径与恢复建议，不回显 session ID、命令、路径参数、源代码或原始异常。交付仍由硬门和项目 CI 机械验收，Hook 不能替代真实验证证据。

## Observation 执行与回查

`scripts/harness-execution.mjs` 公开 `runObserved(spec)` 和 `readObservation(query)`；`scripts/harness-run.mjs` 是不接受任意命令的薄 CLI：

```bash
node scripts/harness-run.mjs --project /absolute/project --task-id task-id --verifier-id verifier-test-0123456789ab
node scripts/harness-run.mjs --project /absolute/project --task-id task-id --read-observation observation-0123456789abcdef01234567
```

观察层只运行逻辑 Harness 目录 `verifiers.json` 中已登记且标记为非交互的 verifier；未知命令仍由原生 `exec_command` 执行。完整 stdout/stderr 写入本地日志。普通调用最多返回 4 KiB，显式宽回执最多 8 KiB；超限时保留头、尾、错误上下文、状态、退出码、超时原因、SHA-256和日志引用。疑似秘密不进入模型可见回执或 `readObservation` 回查，原文只留本地；主归档失败时持久 fallback 仍保存原始字节。

`metrics.jsonl` 增加 `observation_recorded` 与 `observation_recalled`，仅记录 verifier ID、状态、耗时、字节量、截断、归档失败标记与回查次数，不记录命令正文、日志引用、哈希或输出。评估器汇总 Observation 样本量、返回字节比、回查率、归档失败率，以及有重复样本的 verifier 结果一致率。

旧 `.ai/tasks`、`.ai/reports` 和历史 Harness 记录不会被回填或删除；事件流只从启用后开始产生。

## 评估闭环

`harness-evaluate.mjs` 必须显式选择 `--task-id <id>`、`--all` 或 `--rebuild-index`。单任务模式严格读取目标普通 JSON；全量模式读取追加式 `task-index.jsonl`，events 与 metrics 各读取一次。坏索引、未索引任务或超时记录返回部分报告、`complete: false` 与退出码 2，而不是静默跳过或无信息失败。索引重建是显式写操作，8 路并发、单文件 500 毫秒、总计 10 秒止损，不下载 dataless 文件。评估器不运行账本命令，输出：

- 已有结果的任务数、完成且验证通过数；
- 一次通过率：唯一结果为 `completed`、验证 `passed` 且返工次数为 0 的任务数，除以所有已有结果的任务数；
- 最后一条结果的平均澄清轮次和平均返工次数；
- 验证耗时覆盖率，以及仅对已记录样本计算的平均验证秒数；
- 已标准化的 blocked 阻塞分类计数。

评估器不运行账本中的验证命令、不写 JSONL、不创建报告文件，也不扫描其他项目。旧任务记录可以被读取，但如果没有新字段，报告会显示覆盖率不足；这不是速度结论。先让真实任务把覆盖率提升到可用水平，再比较多个项目或考虑更重的编排层。

`verification-plan.mjs` 读取项目 `.agents/verification-policy.json`，根据风险档、变更类型和显式变更路径生成最小充分的测试、lint、文档、CI与硬门闭包；它不执行计划。未知路径及公开契约、schema、数据库、依赖、CI、安全、桌面变化只能升级到完整交付，不能手工降级。

## 跨宿主使用

`project-harness` 是 `leon-engineering` 的共享 workflow；Claude 通过用户级插件发现，Codex 通过受管技能适配器发现。两端必须先读取目标项目规则；对不熟悉项目先运行 `project-adapter`。

## P2：受控恢复与依赖状态

当任务之间存在明确依赖、需要中断后恢复或需要记录一次显式重试时，使用 [Harness P2 控制平面](harness-control-plane.md)。它在同一逻辑 Harness 目录的 `control-plane.json` 里保存 DAG、任务状态、尝试次数、事件和已存在 worktree 的定位信息。每个控制任务以 `harnessTaskId` 显式绑定账本任务：写入控制平面前记录必须已经存在，转换为 `completed` 前其最新账本结果必须为 `completed/passed`。因此编排状态不会被误当成验证事实。

P2 不是任务看板服务、DAG 自动执行器或常驻工作队列。它自身不创建、切换或删除 worktree，不运行 Git、测试、构建或任务命令，也不因失败自动重试；实现任务的 Git 闭环由独立的 `iteration-delivery` 控制器负责。

## Map 新鲜度与运行时生命周期

Harness 运行时由 Codex 全局框架和 Claude 受管策略的安装命令自动部署、校验到 `$HOME/.agents/leon-engineering/runtime`。Codex 全局适配器同时受管 `$HOME/.codex/hooks.json` 中的 Harness Hook：只创建不存在的文件，或接管与模板完全一致的旧文件；发现其他已有 Hook 或漂移时拒绝覆盖。项目根目录不应复制 `scripts/harness-*.mjs`。

runtime 清单记录权威源根目录，使安装后的 `harness-runtime.mjs --verify` 能同时校验安装内容、安装清单与当前权威源。若权威源不可用，验证返回 `canonical source unavailable`，不得把仅内部校验和一致解释为当前版本有效。
若 Hook 报告 runtime 缺失或清单漂移，先执行错误中的恢复命令。确认来源后，从 `/Users/leon/Developer/claude-engineering` 权威源重新运行 Codex 全局安装器，禁止把安装副本当作源码手工维护。

安装副本直接执行 `harness-runtime.mjs --verify` 时只按清单检查自身，不把安装目录误当成权威源码，也不会为了验证创建缺失目录。Codex/Claude 适配器从权威仓库验证时显式传入源码根，因此仍会拒绝相对源码陈旧但内部清单一致的安装。

不确定某个受管 Harness 命令的参数时，先运行对应脚本的 `--help`（或 `-h`）。帮助文本不读取项目、不执行项目命令，也不写入任何文件；项目路径参数统一为 `--project <项目目录>`。

项目已有 Harness 后，Agent Map 不会自动改写。用户明确授权后可执行 `--refresh-agent-map`；它只根据当前项目画像刷新 Map 并追加审计事件，保留任务和结果账本。
