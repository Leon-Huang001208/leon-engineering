# 全局工程工作流：技能治理

主插件 `leon-engineering` 提供六个核心工程入口；可选 `leon-engineering-workflows` 提供三个按需推理入口，以及 `logging-observability` 和 `skill-health`。42 个旧命令留在独立的可选插件。安装时避免同时暴露同一来源的插件和用户目录副本。

现有技能按触发条件分工，而不是为每个项目复制一套流程：

| 技能 | 何时使用 |
|---|---|
| `project-onboarding` | 先只读了解陌生项目；明确授权后才持久化项目配置。 |
| `project-constraints` | 需要把用户已授权项目的架构、文档、日志/错误处理或平台规则作为本地/CI 门禁时。 |
| `project-harness` | 需要让一个已授权项目的目标、验收、交接状态和交付指标跨会话延续时。 |
| `engineering-delivery` | 审查、准备交付；发布与清理按当前任务授权和项目规则分别执行。 |
| `engineering-work` | 在功能交付与缺陷复现两种模式之间选择。 |
| `logging-observability` | 调整日志、错误可观测性或诊断信息。 |
| `agent-routing` | 决定直做、只读调研、worktree 或经同意的团队。 |
| `skill-health` | 审计技能目录、生命周期和重叠触发条件。 |

推理入口是 `problem-framing`、`solution-comparison` 和 `evidence-and-experiments`。各入口的参考资料保留原有十个方法、方法 ID、触发合同和结果要求。

处理可能受益于专门能力的任务时，先检查已安装目录中与目标匹配的 skill、agent 和工具；这属于任务路由，不是安装动作。发现外部候选不等于安装：没有现成匹配时继续以通用能力完成当前工作；只有外部候选预计有明确质量或速度收益，才进入下述生命周期并取得用户同意。

跨宿主的可用范围以 `docs/shared-capability-catalog.md` 为准。目录把已经逐文件比对的宿主共用 skill 与七个规范职责代理列为可路由能力；Claude 专用候选不能因为名称相近而被 Codex 隐式调用或复制。

新增能力必须按以下生命周期处理：

1. 发现：记录候选技能、用途、维护来源和所需权限。
2. 审查：检查提示注入、网络/文件/秘密访问、依赖、许可证、维护状态与现有技能重叠。
3. 安装：获得用户明确同意后，在受控范围内安装；不自动联网安装。
4. 验证：以隔离项目或只读场景验证触发条件、边界和文档。
5. 推广或淘汰：只有重复证明有效的能力才写入长期目录；删除已有技能需要用户批准。

技能不代替项目规则。对任何项目先读取它自己的约束；文档化的可复用经验才能成为全局默认。

全局 Skill 退役使用受管 `skill-portfolio.mjs`，不按名称或“零使用”直接删除。manifest 为每项声明 source、canonical 与预期树哈希；默认只读预览，只有整个批次的源、规范副本、备份目标和 receipt 都通过预检后，`--apply` 才把精确副本移动到 `0700` 备份并写 `0600` receipt。源在预览后变化、符号链接、不可读项、canonical 不同、备份冲突都会让整批零写入停止。回滚同样先验证备份、canonical 与原路径未被占用：

```bash
node "$HOME/.agents/leon-engineering/runtime/skill-portfolio.mjs" --manifest /absolute/actions.json
node "$HOME/.agents/leon-engineering/runtime/skill-portfolio.mjs" --apply --manifest /absolute/actions.json
node "$HOME/.agents/leon-engineering/runtime/skill-portfolio.mjs" --rollback --receipt /absolute/receipt.json
```

项目专属或陈旧 Skill 可用 manifest 的 `kind: "quarantine"` 省略 canonical，但仍必须固定完整源树哈希并保留同样的私有备份/回滚门。复制到项目时只使用受测 sanitizer：排除环境/配置、锁、日志、输出、缓存、Chroma/SQLite、二进制索引和数据表，并在写入前拒绝 included 文本中的 literal secret。项目副本验证完成后，才可隔离全局源。

`project-onboarding` 默认只读，输出路径证据与候选命令。持久化档案需要针对该项目的明确授权。

`project-harness` 对未启用强制协议的项目保持默认只读；对用户已经启用强制 Harness 的目标项目，Agent 必须自动开始或恢复任务，无需逐项要求用户运行命令。结果记录只接受已观察到的验证状态，不能把候选命令或未运行检查写成通过；`harness-enforce` 是跨宿主的只读交付硬门。对已初始化 Harness 的依赖任务、显式重试或中断恢复，P2 控制平面先预览任务 DAG；它只保存状态和已存在 worktree 的定位信息，不创建 worktree、不自动重试，也不运行 Git、测试、构建或任务命令。

`engineering-delivery` 区分审查、交付准备与发布。任何远端写入须由当前任务明确授权，发布方式由项目规则及授权指定。旧控制器仍保留原有 CLI 行为，仅在其直接推送路径获明确授权时使用。

`project-constraints` 默认也只读。它只读取受跟踪的 `.agents/project-constraints.json` 与调用方明确传入的相对变更路径；有违反时以 JSON 和退出码交给 CI，不能把静态检查当作运行时或 Windows 平台验证。

推理方法的选择与完成可通过 Harness 记录脱敏 ID、版本、来源和产物引用。该审计是非阻断的；普通任务没有选方法不会导致 `harness-enforce` 失败。

## 日常任务

### 需求澄清

先查目标项目和已有材料，按目标选择适用的已安装 Skill。需求明确就直接执行。只有待确认的答案会改变范围、方案或验收时才提问，每次只问一个关键问题，并给出推荐选项和取舍。需要澄清时复用 `problem-framing` 的 `socratic-clarification` 方法，旧版可用同名 Skill。低风险且可逆的细节可按项目惯例或合理默认值处理，并说明关键假设。

### 请求示例

| 请求 | 处理方式和验收 |
|---|---|
| 按钮右移 8px | 已定位按钮时直接调整，验证位置偏移和周围布局。 |
| 优化这个 UI | 先查页面现状、项目设计规范和现有组件。如果视觉改版与交互优化会得到不同方案，只问一个关键问题，请用户选择优先结果。按目标选用适用的设计或前端调试 Skill，并验证改动后的界面和操作。 |
| 查原站切日期时的请求 | 用 `reverse-engineer-anything` 在获授权的浏览器会话中记录日期切换，核对请求方法、路径、参数和界面变化。 |
| 把这个功能迁入我的项目 | 用 REA 记录参考功能的操作和结果，结合项目约定用 `engineering-work` 的功能交付流程（旧版 `feature-loop`）实现。用户要求自有接口时可选用有依据的公开数据源，用同一组输入对照界面、交互和数据结果。 |

日常提问可以给出目标、一个具体例子和验收点。需要某个 Skill 的详细问法时，读取它的说明，结合当前任务给出例子。

> 优化估值分析页的筛选体验。切换日期后，我希望一眼看出当前条件，表格和图表也要同步更新。会影响方案的取舍先问我一个问题。
