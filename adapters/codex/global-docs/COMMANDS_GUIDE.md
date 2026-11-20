# 命令与验证

从目标项目确认实际测试与交付命令，按风险运行最小充分检查。只读检查批量执行；完整输出留在私有日志，回执保留错误、状态、退出码与证据引用。

以下命令从选定的框架源目录运行：

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --verify --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --verify-global --codex-home "$HOME/.codex"
node scripts/install-codex-adapter.mjs --rollback-global --codex-home "$HOME/.codex"
```

`--install-global` 只安装短策略、六份指南及 manifest；不安装自动 Hook，也不安装运行时。验证只读且不顺带修复；已有运行时按实际内容核对，未安装时不要求补装。旧直接 Skill 的 `--verify --target /absolute/skills` 兼容入口保留。回滚只处理归属明确且未漂移的框架内容，不恢复整个用户配置。

插件刷新使用目标宿主支持的命令。例如 Codex 的 `codex plugin add leon-engineering@leon-local --json`。移除过注册文件的同版本更新需检查缓存残留；必要时备份后原生卸载再安装，不能把“剩余文件匹配”当成删除已生效。

## 运行时工具按需使用

只有项目规则或当前任务明确选择时才安装、调用：

```bash
node scripts/harness-runtime.mjs --install
node scripts/harness-runtime.mjs --verify
node scripts/profile-project.mjs --project /absolute/project --format markdown
node scripts/verification-plan.mjs --project /absolute/project --base <base-sha>
node scripts/project-constraints.mjs --project /absolute/project --changed-file services/example.py
```

运行时安装与全局策略安装独立；失败按真实状态处理，不手改受管副本或伪造通过。项目档案、静态约束副本和 CI 修改仍只在该项目获准时写入。候选命令不是执行证据。

显式选用账本、观察执行、任务 DAG、Token 审计或 Git 交付时，分别读取 `project-harness`、`iteration-delivery` Skill 及源目录的现行指南，不为普通小改预读这些协议。`harness-enforce` 和 delivery flags 仅属于已选中的相应流程；项目自己的 CI、平台和权限门仍保留。

已知只读命令直接使用原生工具；只为真正的并行收益委派。重试复用已有进程、任务与证据；状态未变化静默。不得隐藏错误或用重复诊断替代执行。
