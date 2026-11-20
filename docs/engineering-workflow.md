# 统一工程工作流

日常直接说明目标与边界，由 `leon-engineering:agent-routing` 确认项目、风险和工作类型。保持已归并的六核心布局：agent-routing、engineering-work、engineering-delivery、project-onboarding、project-constraints、project-harness；可选推理仍为三个分组入口。

| 请求 | 规范正文 |
| --- | --- |
| 功能交付 | `engineering-work/references/feature-loop.md` |
| 缺陷定位与修复 | `engineering-work/references/bugfix-evidence.md` |
| 默认只读的评审 | `engineering-delivery/references/review-ship.md` |
| 显式选择的受管交付 | `engineering-delivery/references/iteration-delivery.md` |

主入口按实质工作需要只读一条匹配子流程。普通聊天、单个已知只读命令和简单解释不增加完整工程流程；项目规则仍决定必要前置检查。工程方法只在相关语言诊断、测试设计、有界维护或范围内的架构判断时读取，角色模板只在确有委派收益或隔离需要时读取。

## 验证与授权

四档风险保持 read-only、local-only、isolated、full-delivery。小改须局部、可逆、无冲突且不影响公开契约、schema、依赖、CI、数据库、安全、桌面或跨平台；不能证明时按项目策略升级。只读任务不修改项目；普通任务不自动建立 Harness。

项目 `.agents/verification-policy.json` 仍拥有完整 changed set 到验收的唯一机器路由。最近测试不替代固定合同、适用 CI 或平台证据；未运行、缺失与受阻保持真实状态。高风险不扩大授权，no-push、只读与仅评审边界持续有效。

评审报告严重性、证据、最小修复建议和未验证区域；修复须在当前授权内。发布遵循项目已有 PR/交付入口。只有项目或任务显式选中受管控制器才使用其 runtime 与 delivery flags；远端授权本身不选择账本，也不许可违反 PR-only 约定的直接推送。

## 兼容与分发

旧独立工程及推理 Skill 已由既有入口归并退休；其方法 ID、参考内容、旧 9/21 项 manifest 的验证和迁移仍受固定合同保护。不能为套用旧本地快照而恢复重复默认入口。agent-routing 曾提供的 feature-development、defect-repair、review 三个参考路径保留为短转发，规范流程只维护一份。插件布局和平铺 adapter 布局都验证这些链接。

engineering-methods 统一位于 engineering-work/references，原有方法来源和许可保留。没有全局或插件自动 Hook；全局安装仅写短策略与指南，runtime 和手动审计由项目或任务明确选择。角色说明中的能力名称不等于已安装工具或新增权限。

42 个旧 commands 入口已经退役，不再保留独立 Skill 或空转发。少量语言验证、审查、文档和知识候选方法并入既有 engineering-methods/review-ship；旧插件 ID、退役映射及历史安装记录继续可读，不恢复缺失的 ECC、Hook、instinct 或平行 session store。详见[退役说明](commands-retirement.md)。

外部同名软链接先取证、核对归属，只有明确授权后才移动链接本身并保留备份，不删除其目标。既有 restored/hash 检查不降低。安装按受管源、合同、宿主分发、实际加载核验顺序核对，不手改安装缓存；旧聊天可能缓存目录，不能用版本号或新任务代替实际刷新证据。
