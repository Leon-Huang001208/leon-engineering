# 项目机械约束

P1 将项目已经存在的工程规则写成受版本控制的 `.agents/project-constraints.json`，并由 `project-constraints.mjs` 在本地或 CI 中检查。它不取代架构审查、测试、原生平台构建或人工验收；它只把适合静态检查的规则变成可重复的门禁。

## 配置

```json
{
  "schemaVersion": 1,
  "requiredFiles": ["AGENTS.md", "docs/ARCHITECTURE.md"],
  "changeRules": [{
    "name": "服务改动需要变更日志",
    "sourcePrefixes": ["services/"],
    "requiredDocuments": ["docs/CHANGELOG.md"]
  }],
  "contentRules": [{
    "name": "服务日志与错误处理",
    "sourcePrefixes": ["services/"],
    "extensions": [".py"],
    "requireAll": ["get_logger", "except "]
  }],
  "ciRules": [{
    "name": "桌面 Windows 健康检查",
    "workflow": ".github/workflows/desktop.yml",
    "requireAll": ["windows-latest", "health"]
  }]
}
```

- `requiredFiles`：项目必须存在且不能是符号链接的规则或架构文件。
- `changeRules`：本次变更触及 `sourcePrefixes` 时，变更集合必须包含至少一个 `requiredDocuments`。
- `contentRules`：本次变更的匹配文件必须包含全部 `requireAll` 文本。只适用于项目确认适合机械检查的范围。
- `ciRules`：点名工作流必须存在，且包含全部平台或健康检查文本。

未知键、绝对路径、`..` 越界和符号链接都会失败；检查器不会执行配置中的文本，也不会运行 Git、测试或构建。

## 将检查器交给 CI

项目 CI 需要运行受跟踪副本，而不是开发机上的全局路径。用户明确授权项目写入后，先预览，再显式安装：

```bash
node scripts/install-project-constraints.mjs --project /absolute/project
node scripts/install-project-constraints.mjs --project /absolute/project --write
```

它只复制规范检查器到 `.agents/project-constraints.mjs`；已有副本默认拒绝覆盖，升级时必须同时传入 `--write --replace`。安装器不创建 JSON 约束配置，也不运行项目命令。

## CI 调用

CI 可以用自己的 Git 差异步骤产生相对路径，再调用：

```bash
node .agents/project-constraints.mjs \
  --project "$GITHUB_WORKSPACE" \
  --changed-file services/example.py \
  --changed-file docs/CHANGELOG.md
```

有违反时标准输出仍是机器可读 JSON，退出码为 1。静态结果只能证明声明的结构规则；不能证明 Windows 构建、安装或运行时健康检查已经执行。
