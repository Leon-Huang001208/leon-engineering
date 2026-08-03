---
name: project-constraints
description: Use when a user-selected project needs architecture, documentation, logging, error-handling, or platform rules enforced by a repeatable local or CI check.
---

# 项目机械约束

先读取目标项目的规则、架构与 CI。默认只读（read-only）执行检查，不创建配置、不运行项目命令，也不自行读取 Git 状态：

```bash
node scripts/project-constraints.mjs --project /absolute/project
node scripts/project-constraints.mjs --project /absolute/project --changed-file services/example.py --changed-file docs/CHANGELOG.md
```

检查器只读取该项目受跟踪的 `.agents/project-constraints.json`，输出 JSON；有违反时退出码为 1。CI 必须自行生成相对变更路径，再逐个传入 `--changed-file`。检查器不运行测试、构建、Git 或账本中的命令。

创建或替换目标项目的 `.agents/project-constraints.json`、修改 CI，必须先获得用户对该项目的明确授权。在配置中只放可验证的项目事实：必需文件、变更必须联动的文档、受限源目录的文本模式，以及 CI 工作流必须具备的平台证据。不要把秘密、推测、聊天内容或未运行平台验证写入配置。

静态检查通过不等于运行时或原生平台验证通过。桌面改动仍须遵循项目的 Windows CI 与安装级烟测要求。
