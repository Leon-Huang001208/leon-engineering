# 全局工程工作流：命令与验证

全局框架不替项目选择构建或测试命令。先从目标仓库的文档、脚本和 CI 中确认命令，再执行最小且相关的验证。

安装器仅维护它拥有的全局内容。以下命令需要从 `leon-engineering` 源仓库运行：

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --verify-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --rollback-global --codex-home "$HOME/.codex"
```

`--install-global` 会先拒绝与用户文件冲突的文档或未受管策略区块。`--verify-global` 只读检查策略和六份文档。`--rollback-global` 只在内容未漂移时移除该框架拥有的文档和标记区块；它不会修改技能、插件、模型、MCP、凭据或项目。

技能安装与全局文档安装是独立操作。不要用全局框架命令代替目标项目的测试、lint、构建、浏览器检查或平台验证。实际运行过的命令和结果才可作为交付证据。
