# leon-engineering Architecture

## 职责边界

```text
host-native agent runtime (model loop, tools, context, sandbox, approval)
                 -> leon-engineering governance and verification
                 -> project-owned configuration and product acceptance
```

宿主负责模型调用、原生 Agent loop、工具协议、上下文/会话及其提供的执行、沙箱和审批能力。框架负责通用工程策略、项目发现、架构约束、影响分析、确定性验收、证据关联、任务交接、安全交付、Skill 治理及薄适配。项目配置拥有模块/路径映射、验证命令、平台支持、必需门和项目约束；业务项目拥有产品行为、领域模型、数据源、服务与真实验收。可选的跨任务编排只在明确需要时启用，不默认驱动普通任务。

普通项目运行不依赖开发者个人插件或 home 目录。需要把共享能力带入项目时，使用固定版本、带 manifest 的受管最小运行时；更新由显式 preview/apply/verify/rollback 完成。

## 模块边界

- Harness：任务、依赖状态、恢复、观察和证据账本；不发起模型推理循环，不替代测试或 CI。
- Verification：只读规划、风险/深度/平台/执行维度、回执和兼容协议；项目策略是机器路由真源，规划器不执行配置命令。
- Project：项目事实发现、候选命令和配置安装；发现不是验证。
- Constraints：静态项目规则；不推断运行时或平台成功。
- Delivery：隔离实现、集成、远端/CI 状态和安全清理；只有明确授权才发布。
- Governance：架构地图、Skill 生命周期、配置画像和文档分类。
- Token audit：脱敏指标；代理指标不冒充 Token 节省。
- Adapters：Codex/Claude 的文件、Hook 和生命周期差异。
- Plugins：核心与默认关闭扩展的分发边界。
- Hooks and agents：事件连接和七个受限职责角色；不拥有核心协议。

精确路径、权威文档和测试见 [机器地图](architecture-map.json) 与 [开发地图](DEVELOPMENT_MAP.md)。

## 权威源

- 一项规则、一份配置和一种协议只有一个可编辑权威源；兼容入口只引用它。
- `plugins/*/skills/*/SKILL.md` 是 Skill 正文真源。
- `lib/` 是宿主无关、项目无关的共享内核；`scripts/` 是稳定 CLI；`adapters/` 只处理宿主差异。安装副本由受管分发产生，不手工维护。
- `docs/architecture-map.json` 只回答职责和资产位置。
- 项目 `.agents/verification-policy.json` 只回答 changed set 触发的影响与验证。
- 任务 JSON 保存任务定义和最新结果，事件/指标账本是追加式记录；可选控制状态只保存依赖与恢复定位。绑定计划和回执用于验收，不能作为第二份可编辑任务状态。Harness、runner 或 CI 产生证据；receipt validator 只验证关联与完整性。

## 数据流

```text
project rules + complete changed set
              -> read-only planner
              -> explicit validations and external gates
              -> runner / CI / manual evidence
              -> bound receipt validator
              -> Harness outcome and handoff
```

未知路径、未知协议、缺失引用、不完整 changed set 或失效证据必须失败或保守升级。Worktree 是文件隔离，不代表更高验证等级；generic 不是所有 OS；高风险也不自动选择无关平台。

当前源码和固定合同验证的是仓库内的 Codex/Claude 适配协议。真实宿主加载、跨宿主行为、CI 与原生平台需要各自回执；定位中的“其他 coding agents”仍是扩展边界，不是已验证兼容列表。历史设计和日期审计仅保留决策与当时证据，以当前源码、策略、现行指南和合同为准。

## 分发与回滚

插件 manifest、Harness runtime manifest 和项目 runtime manifest 分别声明所有权。安装先整批预检，再 staging、哈希 readback 和原子提升；漂移、外来文件、符号链接、部分失败或回滚冲突均 fail closed。真实宿主加载需要独立重启/行为证据。
