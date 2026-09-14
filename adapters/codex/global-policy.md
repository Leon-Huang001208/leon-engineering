## Codex 平台差异

Codex 全局 `PreToolUse`／`PostToolUse` Hook 在本地工具边界建立或恢复宿主隔离的 Harness 上下文，并只记录非敏感事件。初始化失败时仅开放受控诊断读取；写入与未知操作 fail closed。诊断只输出阶段、稳定错误码、runtime／manifest 路径和恢复命令，不回显工具输入。

Codex 没有 Claude 持久命名代理的等价全局格式；需要委派时由主代理按 `agent-routing` 中的受限角色模板创建短期代理，并负责汇总与验证。
