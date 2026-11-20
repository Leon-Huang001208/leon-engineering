# 全局工程工作流：技能治理

主插件提供六个核心入口：`agent-routing`、`engineering-work`、`engineering-delivery`、`project-onboarding`、`project-constraints`、`project-harness`。可选扩展提供三个推理入口及日志/目录治理；42 个旧命令在独立可选包，不默认启用。

先按目标检查已安装能力；发现外部候选不等于安装。跨宿主范围以 `docs/shared-capability-catalog.md` 为准，不复制 Claude 专用能力。Skill 不扩大授权、不代替项目验收。

| 入口 | 用途 |
| --- | --- |
| agent-routing | 项目、风险与按需流程；普通聊天不增加流程 |
| engineering-work | 功能交付或缺陷复现，按需读取一种方法 |
| engineering-delivery | 默认只读的评审、交接；发布须当前任务明确授权 |
| project-onboarding | 陌生项目只读画像；写配置另按项目授权 |
| project-constraints | 项目声明的静态约束与验证入口 |
| project-harness | 项目或任务显式选择的账本、恢复与观察 |

推理按需使用 `problem-framing`、`solution-comparison`、`evidence-and-experiments`；参考资料保留十个原方法 ID 和触发合同。旧工程方法作为规范入口下的参考，不恢复为多个默认 Skill。

## 日常任务

### 需求澄清

先查目标项目和已有材料，按目标选择适用的已安装 Skill。需求明确就直接执行。只有待确认的答案会改变范围、方案或验收时才提问，每次只问一个关键问题，并给出推荐选项和取舍。需要澄清时复用 problem-framing 的 socratic-clarification 方法。低风险且可逆的细节按项目惯例或合理默认值处理，并说明关键假设，不逐项等待流程性确认。

### 请求示例

| 请求 | 处理方式 |
| --- | --- |
| 按钮右移 8px | 已定位按钮时直接调整，验证位置偏移和周围布局 |
| 优化这个 UI | 先查页面、项目规范和现有组件；视觉与交互取舍会改变方案时，只问一个关键问题并给出选项，按目标验证界面与操作 |
| 查原站切日期时的请求 | 用 reverse-engineer-anything 在已授权浏览器会话记录切换，核对请求方法、路径、参数和界面变化 |
| 把这个功能迁入我的项目 | 用 REA 取证后以 engineering-work 结合项目接口实现，对照相同输入的界面、交互和数据 |

外部候选须完成用途、来源、权限、依赖及许可审查，获准安装后再验证。退役用现有 portfolio 的整树哈希、备份和回滚，不因零使用直接删除。

全局安装只维护短规则与指南，不安装 Hook 或默认 runtime。项目测试/平台门保持；未运行不标通过。显式 Harness 不替代真实验证，显式交付控制器不授予长期推送或合并权限。
