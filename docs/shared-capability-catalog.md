# Claude 全量目录审查与共享能力裁决

**审查日期：**2026-08-03  
**范围：**`~/.claude/skills/`、`~/.claude/agents/`、`~/.claude/rules/`、用户级插件和当前共享框架源码。审查使用目录清单、逐文件元数据解析、来源比对、静态权限信号扫描和冲突检查；不执行候选 skill 或 agent 的未知命令。

## 审查基线

- 54 个 Claude skill 入口：38 个真实目录、16 个符号链接；52 个与本机 `.agents/skills` 或 `.cc-switch/skills` 的同名内容逐文件一致。
- 235 个 agent Markdown 文件：230 个元数据完整、2 个 YAML 无效（`a11y-architect`、`zk-steward`）、3 个为说明文件而非 agent。
- 99 个用户级规则 Markdown 文件，其中 55 个 `ecc` 嵌套 skill 和未限定路径的规则会增加每个 Claude 会话的指令负担。
- `leon-engineering@leon-local` 是跨宿主框架的唯一规范插件；其 10 个工作流和 7 个职责代理是稳定的共享基线。

## 共享工作流

以下 51 个能力可由 Claude 与 Codex 按各自宿主目录发现和调用；它们已在两个本机技能源间逐文件比对一致，不需要再次复制或安装：

`auto-coding-agent`、`brainstorming`、`caveman`、`cls`、`cnstock`、`coding-agent`、`diagnose`、`dispatching-parallel-agents`、`docx`、`email-manager`、`executing-plans`、`fetch-url`、`find-skills`、`finishing-a-development-branch`、`github`、`grill-me`、`grill-with-docs`、`hook-development`、`hybrid-search-implementation`、`improve-codebase-architecture`、`model-usage`、`multi-format-rag`、`openclaw-pr-maintainer`、`pdf`、`pdf-analyzer`、`playwright`、`prototype`、`rag-implementation`、`receiving-code-review`、`release`、`requesting-code-review`、`self-improving-agent`、`setup-matt-pocock-skills`、`skill-creator`、`skill-forge`、`skill-vetter`、`subagent-driven-development`、`summarize`、`systematic-debugging`、`tdd`、`test-driven-development`、`to-issues`、`to-prd`、`triage`、`using-git-worktrees`、`using-superpowers`、`verification-before-completion`、`write-a-skill`、`writing-plans`、`writing-skills`、`zoom-out`。

审查中有 52 个入口与 `.agents/skills` 或 `.cc-switch/skills` 的来源内容一致；其中 `data-connector-development` 目前只在 Claude 直接目录可发现，Codex 没有对应入口。因此“同源”不等于“已跨宿主可用”，它不计入上述 51 个共享运行时工作流。

`leon-engineering` 自己管理的共享核心工作流仍是：`agent-routing`、`bugfix-evidence`、`feature-loop`、`logging-observability`、`project-adapter`、`project-bootstrap`、`project-constraints`、`project-harness`、`review-ship`、`skill-health`。两类能力按触发条件路由，不能因目录重复而重复安装。

## 规范职责代理

跨宿主只使用七个规范职责代理：`repo-explorer`、`planner`、`implementer`、`code-reviewer`、`security-reviewer`、`ci-triage`、`docs-mapper`。它们有明确范围、验收与非递归委派边界。

Claude 本地有 230 个完整元数据 agent，但其中大量是行业 persona、未声明来源，或没有可迁移的权限边界；它们保留为 Claude 专用候选。`planner`、`code-reviewer`、`security-reviewer` 的本地旧定义与规范代理同名且行为更宽，应在启用规范插件后退出默认路由，不能与规范角色并存竞争。

## Claude 专用排除项

- `ecc`：55 个嵌套 skill，顶层没有统一的 `SKILL.md`、来源/权限边界和跨宿主映射；仅保留为旧参考目录，不提升为共享能力。
- `zq`：包含账号凭据、爬取、下载和额外 Python 依赖要求；未经单独的来源、许可、凭据和依赖审查，不纳入共享目录。
- `data-connector-development`：当前仅 Claude 直接目录可发现；在 Codex 侧经过来源、权限与安装审查前，不自动复制或标记为共享。
- YAML 无效的 `a11y-architect`、`zk-steward`，以及 3 个说明文件，不作为可路由 agent。

## 全局规则迁移

旧用户规则中与共享框架一致的“依赖需确认、红线操作、skill 文档同步”被合并到受管策略；与快路径冲突的“默认规划、默认派发 agent、任何不确定都阻塞提问、每次错误写固定绝对路径记忆”的规则迁出活动目录并保留备份。语言/项目模式不作为无路径的全局规则加载，而应由目标项目约束或按需 skill 提供。

## CC-Switch 登记同步

CC-Switch 的数字来自其本地登记数据库，并不等同于宿主运行时的扫描结果：Claude 还会加载用户级插件，Codex 还会加载自身的系统能力。因此每次调整共享目录或 `leon-engineering` 插件后，先用以下命令只读审计；确认差异后再加 `--apply`。脚本只修改 CC-Switch 的启用标记，不复制、删除或覆盖任何 skill 文件；写入前会自动备份数据库。

```bash
node scripts/sync-cc-switch-skills.mjs
node scripts/sync-cc-switch-skills.mjs --apply
```

判定规则固定为：Claude 的直接目录加上已启用 `leon-engineering` 插件的十个核心工作流；Codex 只计入其直接 `~/.codex/skills` 目录。UI 必须以此脚本的输出为准，不能把“共享目录中的内容等价”误写成“两个宿主各有相同数量的直接安装目录”。

## 再审条件

候选只有在来源、许可、触发条件、权限/依赖、宿主等价性和隔离验证都记录后，才能从 Claude 专用提升到共享目录。不得因名称相似、安装时间早或用户历史使用而自动提升。
