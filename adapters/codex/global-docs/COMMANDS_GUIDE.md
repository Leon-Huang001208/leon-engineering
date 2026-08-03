# 全局工程工作流：命令与验证

全局框架不替项目选择构建或测试命令。先从目标仓库的文档、脚本和 CI 中确认命令，再执行最小且相关的验证。快路径只运行目标验证，不把项目档案生成、全量测试或全局适配器校验混入普通项目交付。

安装器仅维护它拥有的全局内容。以下命令需要从 `leon-engineering` 源仓库运行：

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --verify-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --rollback-global --codex-home "$HOME/.codex"
```

`--install-global` 会先拒绝与用户文件冲突的文档或未受管策略区块。`--verify-global` 只读检查策略和六份文档。`--rollback-global` 只在内容未漂移时移除该框架拥有的文档和标记区块；它不会修改技能、插件、模型、MCP、凭据或项目。

技能安装与全局文档安装是独立操作。不要用全局框架命令代替目标项目的测试、lint、构建、浏览器检查或平台验证。实际运行过的命令和结果才可作为交付证据。

对用户指定的陌生项目，可从源仓库运行以下只读命令：

```bash
node scripts/profile-project.mjs --project /absolute/project --format markdown
```

它只检查固定的指令、清单、CI 和平台路径，输出的命令均标为 `candidate`，不会执行。只有用户针对该项目明确授权后，才可加入 `--write-profile` 创建 `.ai/project-profile.json`；已有档案还需要 `--replace-profile` 才会更新。安装全局框架本身不会调用该命令或扫描任何项目。

需要跨会话交接一个已授权的项目任务时，先预览 Harness；它不会执行项目命令：

```bash
node scripts/harness-project.mjs --project /absolute/project --task-id task-id --goal "目标" --acceptance "验收标准"
```

只有明确授权后才加 `--write-harness`。完成任务后，执行者先独立运行验证，再用 `--record-outcome` 写入已经观察到的状态、澄清轮次、返工次数和验证命令；记录命令本身不会运行该验证命令。
