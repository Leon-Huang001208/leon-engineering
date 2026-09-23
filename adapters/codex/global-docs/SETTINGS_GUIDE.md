# 全局工程工作流：设置边界

全局安装器不管理模型提供商、认证信息、插件开关、MCP 服务、批准策略、沙箱、通知、浏览器配置或受信任项目列表。这些设置具有安全和账户影响，必须由用户或其明确授权的配置流程单独变更。唯一的独立例外是显式运行 `codex-profile.mjs`：它只允许改变 `model_reasoning_effort` 和已经存在的插件 `enabled` 布尔值，不属于安装器的隐式副作用。

全局安装器只管理：

- `AGENTS.md` 内带有 `leon-engineering` 标记的策略区块；
- `docs/` 内六份同名工作流文档；
- `hooks.json` 内仅属于 `leon-engineering` 的 Harness Hook；
- 记录这些内容校验和的 `.leon-engineering-global.json`。

首次安装只会创建不存在的 `hooks.json`，或安全接管与框架模板完全一致的旧文件；任何其他已有 Hook 文件都会被拒绝，绝不覆盖。验证会报告漂移，回滚只删除未被修改且由框架新建的受管内容。凭据、令牌、私钥和项目机密不应写入全局文档、技能、任务报告或测试夹具。

受管 PreToolUse 在 Harness 初始化失败时不会开放一般 Shell：只放行明确分类的只读诊断，所有修改、安装、Git 写入和未知命令仍拒绝。诊断信息只包含错误阶段、稳定代码、受管路径和恢复命令，不包含完整环境变量、会话标识或工具参数。

## 可回滚 Profile

Profile JSON 只接受 `schemaVersion`、`model_reasoning_effort` 和 `plugins`。默认 preview 返回精确 allowlisted before/after 与配置/profile 哈希，不输出其他 TOML 内容。`--apply` 需要显式私有 backup/receipt 路径，逐行只替换目标值并保留注释、顺序和其他字节；原子写入后立即 readback。`--rollback` 只有在当前配置仍等于 applied 哈希且 backup 仍等于 original 哈希时才恢复：

```bash
node "$HOME/.agents/leon-engineering/runtime/codex-profile.mjs" --config "$HOME/.codex/config.toml" --profile /absolute/profile.json
node "$HOME/.agents/leon-engineering/runtime/codex-profile.mjs" --apply --config "$HOME/.codex/config.toml" --profile /absolute/profile.json --backup /absolute/private-backup.toml --receipt /absolute/private-receipt.json
node "$HOME/.agents/leon-engineering/runtime/codex-profile.mjs" --rollback --config "$HOME/.codex/config.toml" --backup /absolute/private-backup.toml --receipt /absolute/private-receipt.json
```

Profile 只在重启后的固定样本 A/B 同时满足 input、non-cached input 与 weighted usage 严格下降，且质量、错误、工具、权限和必需硬门不变时才晋级。静态 prompt 下降本身不足以修改默认设置。

有关项目级规则优先级见 [代理与项目适配](AGENTS_GUIDE.md)，有关技能安装流程见 [技能治理](SKILLS_GUIDE.md)。
