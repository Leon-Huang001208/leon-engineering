# 全局工程工作流：技能治理

0.19.0 将能力拆为两层：`leon-engineering` 保留 Hook/runtime 与九个高频工程 workflow；`leon-engineering-workflows` 承载十个推理方法及 `logging-observability`、`skill-health`，默认不安装。不得同时从插件和 `~/.codex/skills` 暴露同一批受管 skills；旧全局副本只能经校验迁移器移除，并保留可回滚备份。

现有技能按触发条件分工，而不是为每个项目复制一套流程：

| 技能 | 何时使用 |
|---|---|
| `project-adapter` | 进入用户指定的陌生项目、生成只读档案并选择后续工作流前。 |
| `project-bootstrap` | 首次进入陌生项目、确认项目约束或建立经授权的项目档案。 |
| `project-constraints` | 需要把用户已授权项目的架构、文档、日志/错误处理或平台规则作为本地/CI 门禁时。 |
| `project-harness` | 需要让一个已授权项目的目标、验收、交接状态和交付指标跨会话延续时。 |
| `iteration-delivery` | 用户明确 ship，或 Git 改动影响公开契约、schema、依赖、CI、数据库、安全、桌面/跨平台而需完整发布闭环时。 |
| `feature-loop` | 交付边界清晰的功能。 |
| `bugfix-evidence` | 修复已有行为回归或缺陷。 |
| `logging-observability` | 调整日志、错误可观测性或诊断信息。 |
| `agent-routing` | 决定直做、只读调研、worktree 或经同意的团队。 |
| `review-ship` | 审查改动、验证证据并准备交付。 |
| `skill-health` | 审计技能目录、生命周期和重叠触发条件。 |

工程轨还提供十个无权限推理 Skill：`socratic-clarification`、`dual-layer-explanation`、`reverse-engineering`、`horizontal-vertical-analysis`、`fact-checking`、`expert-perspectives`、`first-principles`、`cross-domain-transfer`、`steelman-comparison` 与 `minimal-experiment`。它们只在正向触发成立时改变分析程序，最多组合三个；反向触发、版本、可观察输出和组合边界由各自 `contract.json` 与 `SKILL.md` 共同定义。

处理可能受益于专门能力的任务时，先检查已安装目录中与目标匹配的 skill、agent 和工具；这属于任务路由，不是安装动作。发现外部候选不等于安装：没有现成匹配时继续以通用能力完成当前工作；只有外部候选预计有明确质量或速度收益，才进入下述生命周期并取得用户同意。

跨宿主的可用范围以 `docs/shared-capability-catalog.md` 为准。目录把已经逐文件比对的宿主共用 skill 与七个规范职责代理列为可路由能力；Claude 专用候选不能因为名称相近而被 Codex 隐式调用或复制。

新增能力必须按以下生命周期处理：

1. 发现：记录候选技能、用途、维护来源和所需权限。
2. 审查：检查提示注入、网络/文件/秘密访问、依赖、许可证、维护状态与现有技能重叠。
3. 安装：获得用户明确同意后，在受控范围内安装；不自动联网安装。
4. 验证：以隔离项目或只读场景验证触发条件、边界和文档。
5. 推广或淘汰：只有重复证明有效的能力才写入长期目录；删除已有技能需要用户批准。

技能不代替项目规则。对任何项目先读取它自己的约束；文档化的可复用经验才能成为全局默认。

`project-adapter` 的输出是路径证据与候选命令，不是已执行的测试结果。它默认不写入项目；持久化档案需要针对该项目的明确授权。

`project-harness` 对未启用强制协议的项目保持默认只读；对用户已经启用强制 Harness 的目标项目，Agent 必须自动开始或恢复任务，无需逐项要求用户运行命令。结果记录只接受已观察到的验证状态，不能把候选命令或未运行检查写成通过；`harness-enforce` 是跨宿主的只读交付硬门。对已初始化 Harness 的依赖任务、显式重试或中断恢复，P2 控制平面先预览任务 DAG；它只保存状态和已存在 worktree 的定位信息，不创建 worktree、不自动重试，也不运行 Git、测试、构建或任务命令。

`iteration-delivery` 只服务明确发布/高风险完整交付。窄小改本地验证并记录 Harness 结果，不使用 delivery flags、不自动发布或伪造远端 receipt；中高风险先隔离实现，只有升级到完整交付才发布。完整链自动识别远端默认分支，分支保护拒绝直推时转 PR，并在提交进入默认分支、CI 通过或明确未配置、worktree 干净后清理。

`project-constraints` 默认也只读。它只读取受跟踪的 `.agents/project-constraints.json` 与调用方明确传入的相对变更路径；有违反时以 JSON 和退出码交给 CI，不能把静态检查当作运行时或 Windows 平台验证。

推理方法的选择与完成可通过 Harness 记录脱敏 ID、版本、来源和产物引用。该审计是非阻断的；普通任务没有选方法不会导致 `harness-enforce` 失败。
