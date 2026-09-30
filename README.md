# leon-engineering

`leon-engineering` 是面向 Codex、Claude 及其他 coding agents 的跨项目工程治理与验证层。它复用宿主的模型推理循环、工具协议和上下文运行时，提供可复用的项目规则、架构约束、变更影响分析、最小充分验收、证据回执、任务交接、Skill 治理、受管交付及薄宿主适配。项目保有自己的业务规则、验证命令和平台支持策略；跨宿主定位不表示所有宿主均已完成真实兼容验证。

## 从这里开始

1. 阅读 [项目规则](AGENTS.md)。
2. 用 [架构说明](docs/ARCHITECTURE.md) 确认职责边界。
3. 用 [开发地图](docs/DEVELOPMENT_MAP.md) 找源码、权威文档、测试与文档同步条件。
4. 在改动前运行现有测试基线，在改动后运行与风险相称的固定合同和项目计划。

## 当前命令

```bash
# 全量本地合同
node --test tests/*.test.mjs

# 架构地图完整性
node scripts/check-architecture-map.mjs --project .

# 对当前 Git changed set 生成绑定计划
node scripts/verification-plan.mjs --project . --base <基线提交>

# 项目机械约束（对完整 changed set 重复传入路径）
node scripts/project-constraints.mjs --project . --changed-file <相对路径>

# 现有项目验收规划兼容入口
node scripts/verification-plan.mjs \
  --project /absolute/project \
  --risk-tier local-only \
  --change-kind internal \
  --changed-file services/example.py

# 绑定计划/回执校验（canonical 产物保存在 Git common 私有目录）
node scripts/validate-verification-receipt.mjs \
  --project /absolute/project \
  --plan /absolute/git-common/leon-engineering/verification/plan.json \
  --receipt /absolute/git-common/leon-engineering/verification/receipt.json

# 代码和文档 whitespace
git diff --check
```

## 关键边界

- `lib/` 是宿主无关、项目无关的共享内核；`scripts/` 保留稳定 CLI、参数、输出和退出码。
- `plugins/*/skills/*/SKILL.md` 是框架 Skill 正文的唯一维护位置；安装副本不手工编辑。
- `adapters/` 只承载宿主差异；共享内核不反向依赖 Codex 或 Claude。
- Codex 插件负责工具前的 guard；受管 User adapter 的 Pre/Post Hook 负责项目账本。同一调用只由一个 Codex Harness 路径登记；Hook 返回不代表命令或验收通过。
- 项目 `.agents/verification-policy.json` 是变更到验收的机器路由真源；项目配置拥有路径映射、验证命令、平台支持和工程约束。
- 架构地图说明“谁拥有源码、文档和测试”；验收策略说明“本次改动必须证明什么”，两者不能相互替代。

## 非目标

- 不把 ResearchWorkbench 或任何业务项目的目录、端口、厂商、桌面运行时或阶段要求写入通用内核。
- 不因源码存在于本机就批量修改其他项目或全局配置。
- 不把本地安装、JSON 合法或模型声明当作真实宿主、CI、原生平台或发布证据。

历史设计、计划和试点证据从 [文档索引](docs/README.md) 查阅；它们不自动代表当前运行契约。
