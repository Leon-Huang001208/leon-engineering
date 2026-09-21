# Token 与最小充分验收 v0.19.0

## 目标

降低固定 skill 上下文、Harness 历史扫描和无关全仓验收造成的模型回合，同时保留安全、公开契约、schema、数据库、CI、桌面和发布硬门。

## 设计

- `leon-engineering` 保留原插件 ID，提供 Hook/runtime 与九个高频工程 workflows。
- `leon-engineering-workflows` 是默认不安装的扩展插件，包含十个推理方法、日志和 skill 治理。
- Codex 全局 skill 迁移器仅移除清单和哈希完全匹配的21个旧副本，保存精确备份并支持回滚；漂移或外来目录 fail closed。
- Harness 为任务写入无目标正文、命令或路径的追加式 `task-index.jsonl`。全量评估读索引并各读取一次 events/metrics；定点评估保持严格。
- `verification-plan.mjs` 根据风险档、变更类型和显式路径生成测试、lint、文档、CI与硬门闭包，未知路径只能升级。
- verifier 普通模型回执最多4 KiB，显式宽回执最多8 KiB；全文仍以0600权限留在本地。

## 兼容与回滚

旧插件 ID、Hook恢复命令、Harness任务文件和 delivery receipt 保持兼容。安装和插件目录变化需要完整重启 Codex 宿主；新任务不是热刷新边界。扩展插件未安装时不影响核心 Harness 与交付流程。

## 验收

框架测试覆盖插件目录拆分、全局副本迁移/回滚、索引不完整报告、重建超时、4/8 KiB回执和风险升级。真实 Token 降幅只在重启后、相同模型/任务/提交的 A/B 中确认；任何严格正降幅可晋级，但质量、错误和必需门不得变差。
