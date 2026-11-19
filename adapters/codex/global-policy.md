## Codex 平台差异

Codex 全局 `PreToolUse`／`PostToolUse` Hook 在本地工具边界建立或恢复宿主隔离的 Harness 上下文，并只记录非敏感事件。初始化失败时仅开放受控诊断读取；写入与未知操作 fail closed。诊断只输出阶段、稳定错误码、runtime／manifest 路径和恢复命令，不回显工具输入。

Codex 无 Claude 式持久命名代理。委派时主代理按 `agent-routing` 的受限角色模板创建短期代理，汇总并验证。

按全局 `docs/SKILLS_GUIDE.md` 澄清影响范围、方案或验收的歧义。
