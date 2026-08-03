# Harness v1：项目级持续交付状态

Harness v1 解决“新会话忘记上下文、完成标准不稳定、无法衡量返工”的基础问题。它不接管项目管理系统，不启动常驻 Agent，也不替代项目自己的 `AGENTS.md`、CI 或测试。

## 结构

对用户明确选择的项目和任务，`scripts/harness-project.mjs` 可生成：

- `.ai/harness/agent-map.md`：从受限项目画像得出的指令、候选验证命令和 CI 入口；项目指令优先。
- `.ai/harness/tasks/<task-id>.json`：目标、验收标准、当前状态和已记录的结果。
- `.ai/harness/metrics.jsonl`：任务创建与结果事件，用于统计澄清轮次、返工次数和验证状态。

默认命令只输出预览。`--write-harness` 是项目内写入的明确边界；已有 Harness 或同名任务不会被覆盖。`--record-outcome` 只保存执行者已经获得的证据文本，绝不执行命令、读取环境变量或访问网络。

## 跨宿主使用

`project-harness` 是 `leon-engineering` 的共享 workflow；Claude 通过用户级插件发现，Codex 通过受管技能适配器发现。两端必须先读取目标项目规则；对不熟悉项目先运行 `project-adapter`。

## 当前边界

这是 Harness 的状态与测量底座，不是任务看板、DAG 调度器、常驻工作队列或自动合并系统。只有先在多个项目收集到真实的沟通轮次、返工和验证数据后，才评估是否需要引入更重的编排层。
