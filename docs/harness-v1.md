# Harness v1：项目级持续交付状态

Harness v1 解决“新会话忘记上下文、完成标准不稳定、无法衡量返工”的基础问题。它不接管项目管理系统，不启动常驻 Agent，也不替代项目自己的 `AGENTS.md`、CI 或测试。

## 结构

对用户明确选择的项目和任务，`scripts/harness-project.mjs` 可生成：

- `.ai/harness/agent-map.md`：从受限项目画像得出的指令、候选验证命令和 CI 入口；项目指令优先。
- `.ai/harness/tasks/<task-id>.json`：目标、验收标准、当前状态和已记录的结果。
- `.ai/harness/metrics.jsonl`：任务创建与结果事件，用于统计澄清轮次、返工次数、验证状态、实测验证耗时和阻塞分类。

默认命令只输出预览。`--write-harness` 是项目内写入的明确边界；已有 Harness 或同名任务不会被覆盖。`--record-outcome` 只保存执行者已经获得的证据，绝不执行命令、读取环境变量或访问网络。每条新结果都必须附带执行者实际测得的 `verificationDurationSeconds`；`blocked` 结果还必须附带标准化 `blockerCategory`。这些字段不是脚本估算出来的，也不能从聊天内容回填。

## 评估闭环

`scripts/harness-evaluate.mjs --project /absolute/project --format markdown` 只读指定项目的任务记录，输出：

- 已有结果的任务数、完成且验证通过数；
- 一次通过率：唯一结果为 `completed`、验证 `passed` 且返工次数为 0 的任务数，除以所有已有结果的任务数；
- 最后一条结果的平均澄清轮次和平均返工次数；
- 验证耗时覆盖率，以及仅对已记录样本计算的平均验证秒数；
- 已标准化的 blocked 阻塞分类计数。

评估器不运行账本中的验证命令、不写 JSONL、不创建报告文件，也不扫描其他项目。旧任务记录可以被读取，但如果没有新字段，报告会显示覆盖率不足；这不是速度结论。先让真实任务把覆盖率提升到可用水平，再比较多个项目或考虑更重的编排层。

## 跨宿主使用

`project-harness` 是 `leon-engineering` 的共享 workflow；Claude 通过用户级插件发现，Codex 通过受管技能适配器发现。两端必须先读取目标项目规则；对不熟悉项目先运行 `project-adapter`。

## P2：受控恢复与依赖状态

当任务之间存在明确依赖、需要中断后恢复或需要记录一次显式重试时，使用 [Harness P2 控制平面](harness-control-plane.md)。它在同一项目的 `.ai/harness/control-plane.json` 里保存 DAG、任务状态、尝试次数、事件和已存在 worktree 的定位信息。每个控制任务以 `harnessTaskId` 显式绑定账本任务：写入控制平面前记录必须已经存在，转换为 `completed` 前其最新账本结果必须为 `completed/passed`。因此编排状态不会被误当成验证事实。

P2 不是任务看板服务、DAG 自动执行器、常驻工作队列或自动合并系统。它不创建、切换或删除 worktree；不运行 Git、测试、构建或任务命令；不因失败自动重试。只有先在多个项目收集到真实的沟通轮次、返工、验证耗时和阻塞数据后，才评估是否需要更重的编排层。

## Map 新鲜度与运行时生命周期

Harness 运行时由 Codex 全局框架和 Claude 受管策略的安装命令自动部署、校验到 `$HOME/.agents/leon-engineering/runtime`。项目根目录不应复制 `scripts/harness-*.mjs`。

不确定某个受管 Harness 命令的参数时，先运行对应脚本的 `--help`（或 `-h`）。帮助文本不读取项目、不执行项目命令，也不写入任何文件；项目路径参数统一为 `--project <项目目录>`。

项目已有 Harness 后，Agent Map 不会自动改写。用户明确授权后可执行 `--refresh-agent-map`；它只根据当前项目画像刷新 Map 并追加审计事件，保留任务和结果账本。
