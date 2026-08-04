# Harness P0.1：运行时分发与证据修复实施计划

> **执行约定：** 当前会话内联执行；每项实现先有失败测试，并在全量回归后才安装或改写项目证据。

**目标：** 让 Codex 和 Claude 的受管适配器安装并验证同一套稳定 Harness 运行时，使项目不再依赖不存在的 `scripts/harness-*.mjs` 相对路径，并把 AlphaFoundry 的旧完成记录降级为无效证据后获得真实可运行证据。

**架构：** 规范源仍保留四个 Harness 模块；新增原子复制、清单校验和漂移检测，将它们部署到用户目录下的受管运行时。两个适配器安装各自策略时都调用同一部署模块。共享 skill 改为调用稳定运行时路径。AlphaFoundry 的历史任务不删除，改为追加“证据无效”结果；随后运行真实预览、评估和重新记录的结果。

**技术栈：** Node.js 内置文件系统、加密校验、`node:test`、既有适配器与 Harness JSONL 账本。

---

## 任务 1：受管运行时

- [ ] 先新增 `tests/harness-runtime.test.mjs`，断言模块缺失；测试安装四个文件、清单验证、漂移拒绝和安装副本可对临时项目执行真实只读 Harness 预览。
- [ ] 实现 `scripts/harness-runtime.mjs`：默认运行时根目录为 `$HOME/.agents/leon-engineering/runtime`；只复制 `harness-project.mjs`、`harness-evaluate.mjs`、`harness-control.mjs`、`profile-project.mjs`；原子写入清单，拒绝符号链接和未受管覆盖。
- [ ] 运行目标测试并确认通过。

## 任务 2：两端适配器与共享路由

- [ ] 先扩展 Codex/Claude 适配器测试，断言安装后受管运行时存在且校验通过，运行时根目录可由测试目录显式注入。
- [ ] 将运行时安装和校验接入 `install-codex-adapter.mjs --install-global/--verify-global` 与 `install-claude-adapter.mjs --install/--verify`；更新清单版本、共享 skill 和中文命令文档，禁止项目根目录相对脚本路径。
- [ ] 运行相关适配器、目录和运行时测试。

## 任务 3：AlphaFoundry 证据修复与真实验证

- [ ] 扩展 Harness 结果格式与测试，允许显式 `invalidated` 结果，要求不可为空的失效理由，并让评估器将最新失效结果视为非通过。
- [ ] 从已验证运行时对 AlphaFoundry 追加历史证据失效记录；不删除旧事件、不改动无关文件。
- [ ] 使用运行时真实运行预览、只读评估，并对已执行命令记录带实测耗时的新结果；保存 `.ai/reports` 中文报告。
- [ ] 全量回归、适配器零漂移、运行时零漂移、实际 Alpha 命令及账本检查通过后，提交、合并和安装 0.11.0；GitHub/Windows runner 未触发时明确标注未验证。
