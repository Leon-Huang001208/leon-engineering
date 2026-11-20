# 旧 commands 入口退役

42 个 `source-command-*` Skill 入口已从源码分发移除。日常工程保留六核心，五个可选方法仍按需启用；不新增 Skill、自动 Hook、全局状态库或任务调度器。

## 保留什么

- `leon-engineering-commands` 插件 ID、版本和两份宿主 manifest 保留为退休元数据，不声明 Skills、agents、Hook 或 MCP。
- `command-map.json` 是唯一退休清单：`commands` 为空，42 个旧名字各有分类、原因和参考去向，原 `hello`/`jira` quarantine 记录原样保留。参考路径用于阅读，不是可执行别名。
- 五个重复流程由现有入口承接；十六个旧体系入口的外部依赖和全局存储约定不再作为本框架能力宣称；二十一个条目的局部方法压缩进既有 engineering-methods/review-ship。
- 历史 9/21 项 manifest 的读取、恢复、项目固定运行时及 CLI 参数不因本次退休改变。既有 Claude 安装也不由此源码变更自动修改。

## 日常入口

功能与构建修复使用 `agent-routing` → `engineering-work`；默认只读评审与交接使用 `engineering-delivery`。语言检查仅运行项目已有且相关的命令，不安装缺失工具、不按通用比例强加覆盖率，也不因样式偏好判定阻断缺陷。文档从实际 manifest/schema/routes/exports 核对；清理先核动态入口和外部消费者；知识候选先查重再吸收或丢弃。

会话沿宿主原生历史和项目既有交接位置延续。旧 ECC updater、Hookify executor、instinct CLI 和平行 session store 均不由退休包重新提供；已有历史文件保持原归属。

## 发现与安装

Skill 发现规划器只将 core/workflows 两个活动根作为 canonical；活动根缺失、别名或重名仍按原合同拒绝。退休包即使残留同名目录，也不使用户旧命令自动成为迁移或删除候选。

源码退休、用户目录处理、插件缓存更新与真实宿主加载分别核验。用户要求直接删除指定旧副本且不用备份时，核对其精确路径后按该授权执行；这不会授权删除其他同名或共享内容。已默认关闭的命令包移除后，不能仅据源码字节减少声称当前会话 Token 降幅。
