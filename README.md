# leon-engineering

当前分发版本为 **0.19.4**：保留事件驱动资源清理与显式审计工具，默认不注册工具边界 Hook。核心与默认关闭的可选扩展保持版本一致；安装后以内容校验和宿主实际加载确认更新，不自动开启扩展。

`leon-engineering` 提供按需工程 Skills 和可显式调用的项目验证、交付工具。默认不注册 Hook、不启动 Harness，也不替项目决定测试流程。项目规则拥有项目约束；调用方角色指令（例如 Paperclip 工程师）拥有岗位职责；宿主负责模型、工具和实际权限。跨宿主能力仍按实际验收记录区分。

源码当前整理为六个核心工程入口、三个按需推理入口和两个专项入口。42 个兼容命令仍在默认关闭的可选包中；项目固定运行时与 CI 保持原有接口。

## 从这里开始

1. 阅读 [项目规则](AGENTS.md)。
2. 用 [架构说明](docs/ARCHITECTURE.md) 确认职责边界。
3. 用 [开发地图](docs/DEVELOPMENT_MAP.md) 找源码、权威文档、测试与文档同步条件。
4. 在改动前运行现有测试基线，在改动后运行与风险相称的固定合同和项目计划。

日常工程任务从 `leon-engineering:agent-routing` 进入：先确认项目与风险，再按需读取 `engineering-work` 的功能/修复参考或 `engineering-delivery` 的评审/交付参考。保留 GitHub 已合并的六核心入口和三个推理入口；旧方法 ID、安装 manifest 迁移及参考链接继续受测。发布按项目授权流程执行，受管交付控制器仅在明确选用时调用。详见 [工程工作流](docs/engineering-workflow.md)。

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

重复 Skill 入口先用 [发现目录收敛指南](docs/skill-discovery.md) 生成只读迁移清单，再通过现有 portfolio 预览、应用和回滚。规范插件与全局同名副本分开核验；不会因为生成清单就修改全局目录。

## 关键边界

开发产物使用[事件驱动生命周期](docs/resource-lifecycle.md)：交付、部署验收、明确退休及恢复事件触发回收；保留有限回滚和最小记录，不建立定时清理任务。安装与全局启用单独验收。

- `lib/` 是宿主无关、项目无关的共享内核；`scripts/` 保留稳定 CLI、参数、输出和退出码。
- `plugins/*/skills/*/SKILL.md` 是框架 Skill 正文的唯一维护位置；安装副本不手工编辑。
- `adapters/` 只承载宿主差异；共享内核不反向依赖 Codex 或 Claude。
- 默认插件和全局安装均不注册 PreToolUse/PostToolUse；`--install-global` 仅维护短规则与按需指南。Harness、审计和运行时由项目或任务显式选择，普通工具调用不会自动建账本。
- 项目 `.agents/verification-policy.json` 是变更到验收的机器路由真源；项目配置拥有路径映射、验证命令、平台支持和工程约束。
- 架构地图说明“谁拥有源码、文档和测试”；验收策略说明“本次改动必须证明什么”，两者不能相互替代。
- 交付恢复必须证明登记候选与基线已进入所属集成分支；干净工作树不等于已归并。命令失败与内容冲突分别记录，诊断仅输出稳定分类和 stderr 字节数/哈希，见 [交付控制器](docs/iteration-delivery.md)。

## 非目标

- 不把 ResearchWorkbench 或任何业务项目的目录、端口、厂商、桌面运行时或阶段要求写入通用内核。
- 不因源码存在于本机就批量修改其他项目或全局配置。
- 不把本地安装、JSON 合法或模型声明当作真实宿主、CI、原生平台或发布证据。

历史设计、计划和试点证据从 [文档索引](docs/README.md) 查阅；它们不自动代表当前运行契约。

显式平台任务使用 `verification-plan.mjs --project <repo> --base <base-sha> --task-context <项目相对JSON>`；其 plan4/receipt3 将本宿主完成与总体验收分开，旧模式仍输出旧协议。详见 [平台任务验收](docs/platform-task-verification.md)。
