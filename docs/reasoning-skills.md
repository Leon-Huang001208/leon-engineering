# 工程推理 Skills

十个推理 Skill 是 Codex 与 Claude 工程轨的共享判断程序，不是 Research Workbench 的 Runtime，也不授予工具、数据、网络、依赖、发布或破坏性操作权限。

## 路由原则

- 先服从用户请求、项目规则、权限边界和已验证事实。
- 仅在触发条件成立且能改善可观察输出时选择方法；明确反向触发时不选择。
- 单个任务最多组合三个方法，并在输出中留下该 Skill 定义的可观察产物。
- 选择与完成可写入 Harness 的脱敏事件；普通任务未选择方法不会被交付硬门阻断。

## 版本与安装

每个目录同时包含 `SKILL.md` 和 `contract.json`。后者保存稳定 `methodId`、语义版本、无权限声明及正反触发样例。Codex 与 Claude adapter 都将权威目录复制到各自临时或真实 Skill 目录，manifest 对完整目录计算 SHA-256；外来同名目录、漂移安装和漂移回滚均会失败。

真实用户目录安装必须在临时目标的安装、校验、漂移和回滚测试通过后单独授权。

## Harness 事件

```text
reasoning_method_selected: host, methodId, methodVersion, source
reasoning_method_completed: host, methodId, methodVersion, artifactRef
```

事件白名单拒绝 Prompt、文档正文、命令、路径和隐藏思维链。评估器只统计方法采用、组合、完成、返工和任务验证结果，不执行任何记录内容。
