# 高吞吐全局交付协议实施计划

> **供代理执行：**必须使用 `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行；所有步骤使用复选框追踪。

**目标：**让 Codex 和 Claude Code 对常规有边界任务默认直做、最小验证，仅在有证据的复杂性或明确风险出现时才升级流程。

**架构：**保留 `skills/` 作为唯一共享工作流源，并把快路径和升级边界写入 Codex 受管策略、Claude 受管策略与 `agent-routing`。Codex 继续通过 `install-codex-adapter.mjs` 管理其全局区块；新增独立 Claude 安装器，只管理 `~/.claude/CLAUDE.md` 内的标记区块和自己的清单。两端安装器都先在临时主目录通过测试，再更新真实全局目录。

**技术栈：**Node.js 内置模块和测试运行器、SHA-256、JSON、Markdown、Claude Code 插件 CLI、Git worktree。

---

## 文件映射

| 路径 | 改动 | 职责 |
|---|---|---|
| `adapters/codex/global-policy.md` | 修改 | Codex 的默认快路径和升级边界。 |
| `adapters/codex/global-docs/GETTING_STARTED.md` | 修改 | 将日常任务流程改为先判定快路径，而不是强制项目档案。 |
| `adapters/codex/global-docs/AGENTS_GUIDE.md` | 修改 | 写明代理的正向派发门槛和 Codex/Claude 代理差异。 |
| `adapters/codex/global-docs/COMMANDS_GUIDE.md` | 修改 | 说明两端安装、校验与不应运行的无关检查。 |
| `skills/agent-routing/SKILL.md` | 修改 | 让“直接执行”成为默认，定义值得派发代理的条件。 |
| `skills/agent-routing/references/codex-role-templates.md` | 修改 | 所有 Codex 角色模板加入任务契约和“不得增加流程性问题”边界。 |
| `adapters/claude/global-policy.md` | 新建 | Claude Code 使用的等价受管快路径策略。 |
| `scripts/install-claude-adapter.mjs` | 新建 | 安装、校验和回滚 Claude 受管策略区块。 |
| `tests/claude-adapter.test.mjs` | 新建 | 覆盖 Claude 安装器的保留、冲突、漂移、回滚和 CLI 行为。 |
| `tests/catalog.test.mjs` | 修改 | 固定快路径文字、正向派发门槛与中英文文档要求。 |
| `.claude-plugin/plugin.json` | 修改 | 发布 `0.6.0`。 |
| `.claude-plugin/marketplace.json` | 修改 | 发布 `0.6.0`。 |
| `docs/high-throughput-pilot.md` | 新建 | 三条执行路径的非生产验证夹具与记录格式。 |
| `docs/pilot-results.md` | 修改 | 记录真实的全局安装和双端验证证据。 |
| `docs/README.md` | 修改 | 索引新的试点文档和本计划。 |

### 任务 1：先固定快路径契约

**文件：**
- 修改：`tests/catalog.test.mjs`
- 测试：`tests/catalog.test.mjs`

- [x] **步骤 1：写出会失败的快路径断言**

在 `tests/catalog.test.mjs` 添加：

```js
test("defaults bounded work to the documented fast path", () => {
  const policy = fs.readFileSync(
    path.join(root, "adapters", "codex", "global-policy.md"),
    "utf8"
  );
  const routing = readSkill("agent-routing");
  assert.match(policy, /默认走快路径/);
  assert.match(policy, /不创建计划、不调用子代理、不创建 worktree/);
  assert.match(routing, /只有在.*明确速度收益.*时才派发代理/);
  assert.match(routing, /不得为了流程而向用户提问/);
});

test("keeps fast path documentation aligned", () => {
  const documents = [
    {name: "GETTING_STARTED.md", phrase: /快路径/},
    {name: "AGENTS_GUIDE.md", phrase: /Claude Code.*Codex/},
    {name: "COMMANDS_GUIDE.md", phrase: /不把项目档案/}
  ];

  for (const {name, phrase} of documents) {
    const source = fs.readFileSync(
      path.join(root, "adapters", "codex", "global-docs", name),
      "utf8"
    );
    assert.match(source, /^# .*[一-鿿]/m);
    assert.match(source, phrase);
  }
});
```

- [x] **步骤 2：确认 RED**

运行：

```bash
node --test tests/catalog.test.mjs
```

预期：第一项因现有策略没有“默认走快路径”及相应路由文字而失败；质量审查后，第二项已将语言标题检查收敛为实际快路径文档契约，并因三个全局文档尚未包含相应快路径文本而失败。

- [x] **步骤 3：提交失败测试**

```bash
git add tests/catalog.test.mjs
git commit -m "test: define fast path delivery contract"
```

实际证据：已提交 `083df36`（`test: define fast path delivery contract`）。

### 任务 2：实现共享快路径与正向代理门槛

**文件：**
- 修改：`adapters/codex/global-policy.md`
- 修改：`adapters/codex/global-docs/GETTING_STARTED.md`
- 修改：`adapters/codex/global-docs/AGENTS_GUIDE.md`
- 修改：`adapters/codex/global-docs/COMMANDS_GUIDE.md`
- 修改：`skills/agent-routing/SKILL.md`
- 修改：`skills/agent-routing/references/codex-role-templates.md`
- 测试：`tests/catalog.test.mjs`

- [x] **步骤 1：在 Codex 策略加入明确快路径**

在 `adapters/codex/global-policy.md` 的优先级说明之后插入以下两条，保留现有风险升级条目：

```md
- 对范围明确、可逆且本地的常规任务，默认走快路径：只读取相关指令和文件，直接实施，运行最小相关验证并交付；不创建计划、不调用子代理、不创建 worktree、不运行无关检查，也不得为了流程而向用户提问。
- 只有范围不明、探索会明显阻塞主任务、并行编辑有明确速度收益，或风险/耦合需要隔离时，才升级为只读调研、worktree 或代理；主代理负责汇总和验证。
```

- [x] **步骤 2：把入门与代理文档改为先判定快路径**

将 `GETTING_STARTED.md` 的任务顺序替换为：先识别目标和相关项目规则；若符合快路径则直接完成；只有陌生且需要证据时才运行 `project-adapter`；随后才选择验证和代理。向 `AGENTS_GUIDE.md` 加入：

```md
- 不因存在某个代理而派发代理；只有其独立产出能减少主任务等待或上下文拥塞时才派发。
- Claude Code 使用插件中的命名代理；Codex 使用同职责的短生命周期角色模板。两者职责相同，但运行时隔离与工具限制分别由各自宿主执行。
```

在 `COMMANDS_GUIDE.md` 明确：快路径只运行目标验证命令，不把项目档案生成、全量测试或全局适配器校验混入普通项目交付。

- [x] **步骤 3：更新 `agent-routing` 与 Codex 模板**

将 `skills/agent-routing/SKILL.md` 的首段替换为：

```md
已知文件、窄范围改动或明确命令默认由主会话直接完成；不得为了流程而向用户提问；不得仅因可用就创建计划、代理或 worktree。只有在只读探索能减少主会话等待或上下文拥塞，或并行编辑有明确速度收益时才派发代理，并且须在派发前说明预期收益和边界。风险或耦合需要隔离时必须升级，必要时使用 worktree；该条件不以速度收益为前提。
```

在角色模板顶部加入：`先复用主任务已确认的结果、范围和验收；除真实阻塞外不得要求用户重复说明或增加流程性问题。`

- [x] **步骤 4：确认 GREEN**

运行：

```bash
node --test tests/catalog.test.mjs
node --test tests/codex-adapter.test.mjs
```

预期：全部通过；后者证明现有 Codex 安装器仍能复制更新后的完整技能目录。

实际证据：`tests/catalog.test.mjs` 8/8、`tests/codex-adapter.test.mjs` 7/7 通过。

- [x] **步骤 5：提交共享策略**

```bash
git add adapters/codex/global-policy.md adapters/codex/global-docs skills/agent-routing tests/catalog.test.mjs
git commit -m "feat: default bounded work to the fast path"
```

实际证据：已提交 `1ae2a4f`、`c2d64a4`、`fbf1248`。

### 任务 3：以测试驱动加入 Claude 受管策略安装器

**文件：**
- 新建：`adapters/claude/global-policy.md`
- 新建：`scripts/install-claude-adapter.mjs`
- 新建：`tests/claude-adapter.test.mjs`

- [x] **步骤 1：写 Claude 安装器的失败测试**

创建 `tests/claude-adapter.test.mjs`：

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  installClaudePolicy,
  verifyClaudePolicy,
  rollbackClaudePolicy
} from "../scripts/install-claude-adapter.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function makeClaudeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leon-claude-policy-"));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  return home;
}

test("installs a bounded Claude policy without replacing user text", t => {
  const home = makeClaudeHome(t);
  const original = "# Personal rules\nKeep this text.\n";
  fs.writeFileSync(path.join(home, "CLAUDE.md"), original);
  installClaudePolicy({sourceRoot, claudeHome: home});
  assert.match(fs.readFileSync(path.join(home, "CLAUDE.md"), "utf8"), /Keep this text\./);
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome: home}).valid, true);
  rollbackClaudePolicy({sourceRoot, claudeHome: home});
  assert.equal(fs.readFileSync(path.join(home, "CLAUDE.md"), "utf8"), original);
});

test("rejects foreign or drifted Claude policy blocks", t => {
  const home = makeClaudeHome(t);
  fs.writeFileSync(path.join(home, "CLAUDE.md"), "<!-- leon-engineering:claude-policy:start -->\nforeign\n<!-- leon-engineering:claude-policy:end -->\n");
  assert.throws(() => installClaudePolicy({sourceRoot, claudeHome: home}), /foreign Claude policy block/);
  fs.writeFileSync(path.join(home, "CLAUDE.md"), "# Personal rules\n");
  installClaudePolicy({sourceRoot, claudeHome: home});
  const policyPath = path.join(home, "CLAUDE.md");
  fs.writeFileSync(
    policyPath,
    fs.readFileSync(policyPath, "utf8").replace("默认走快路径", "外来改动")
  );
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome: home}).valid, false);
  assert.throws(() => rollbackClaudePolicy({sourceRoot, claudeHome: home}), /drifted Claude policy/);
});
```

- [x] **步骤 2：确认 RED**

运行：

```bash
node --test tests/claude-adapter.test.mjs
```

预期：因 `scripts/install-claude-adapter.mjs` 不存在而失败，且没有改动真实 `~/.claude`。

- [x] **步骤 3：实现受管区块和清单**

创建 `adapters/claude/global-policy.md`，内容与 Codex 的快路径和升级边界等价，并以以下句子开头：

```md
本受管区块优先于旧目录或旧代理目录中“默认先规划、先委派或全量验证”的建议；项目规则和明确风险升级要求仍优先。
```

创建 `scripts/install-claude-adapter.mjs`，导出 `installClaudePolicy`、`verifyClaudePolicy`、`rollbackClaudePolicy`。实现使用以下常量和清单形状：

```js
const START = "<!-- leon-engineering:claude-policy:start -->";
const END = "<!-- leon-engineering:claude-policy:end -->";
const MANIFEST = ".leon-engineering-claude-policy.json";

const manifest = {
  schemaVersion: 1,
  adapter: "leon-engineering",
  frameworkVersion,
  sourceCommit,
  state: "installing" | "active" | "rolling_back",
  policy: {checksum, prefix, suffix, hadClaudeFile, placementChecksum}
};
```

实现必须：拒绝孤立、重复或外来标记；以 SHA-256 校验完整标记区块和 `{prefix,suffix,hadClaudeFile}` 的独立 `placementChecksum`。安装使用可恢复的 staged 提交：先原子写入 `installing` 清单，再写入 `CLAUDE.md` 标记区块，最后原子升级为 `active`；对自身 `installing` 的无标记状态清理 pending 后重试，对完整且未漂移的标记升级或安全完成。回滚先写 `rolling_back`，再恢复 `CLAUDE.md`，最后删除清单；无标记的 `rolling_back` pending 在下一次操作清理。任何标记/清单不一致或漂移都必须拒绝，不能自动吞掉。

`writeAtomically` 在写入或 rename 失败时必须尽力清理 0600 临时文件。安装中 active 清单升级失败时须补偿恢复原 `CLAUDE.md` 与原清单，避免留下半安装状态；回滚失败则保留可识别的 pending 状态。回滚前重新校验 placement，且仅去除自身区块并恢复原前后缀。所有成功与失败路径向 stderr 输出不含路径、命令、秘密或用户内容的 JSON 日志；CLI 失败日志使用稳定安全的 `code`（如 `invalid_arguments`、`foreign_policy`、`drifted_policy`、`invalid_manifest`、`operation_failed`）。CLI 支持：

`verifyClaudePolicy()` API 在漂移时仍返回 `{valid:false, drift:["policy"]}` 供调用方检查；但 CLI 的 `--verify` 检测到漂移时必须以 `drifted_policy` 安全错误码写入 stderr 并非零退出，不能将失败结果作为成功的 stdout 响应。

CLI 成功执行 `--install` 时，stdout 只能返回 `{installed:true, frameworkVersion}` 安全摘要；库 API 仍返回完整清单供内部调用。stdout 和 stderr 均不得输出清单、前后缀、用户文本、路径或 `sourceCommit`。

```bash
node scripts/install-claude-adapter.mjs --install --claude-home /tmp/home
node scripts/install-claude-adapter.mjs --verify --claude-home /tmp/home
node scripts/install-claude-adapter.mjs --rollback --claude-home /tmp/home
```

- [x] **步骤 4：确认 GREEN**

运行：

```bash
node --check scripts/install-claude-adapter.mjs
node --test tests/claude-adapter.test.mjs
```

预期：基础保留、外来区块、内容漂移与 CLI 成功路径通过，并新增四类回归测试：

1. 注入 active 清单 rename 失败，确认补偿恢复原内容、无 pending/临时文件且后续可安装。
2. 仅篡改清单 `policy.prefix`，确认 placement 校验使 verify 失败、rollback 拒绝且用户换行不丢失。
3. 构造自身 `installing` 清单的完整标记与无标记两种中断状态，确认下一次安装恢复为 `active` 且有效。
4. 对 unsupported、多个动作和缺少 `--claude-home` 参数断言 CLI 以退出码 1 和安全 `invalid_arguments` 错误码失败。
5. 篡改已安装区块后精确断言 API 返回 `{valid:false, drift:["policy"]}`；CLI `--verify` 必须以退出码 1 失败、stdout 为空，stderr 仅有一行且 JSON 严格等于 `{component:"claude-adapter",event:"command_failed",code:"drifted_policy"}`，并且不得泄露临时目录、用户哨兵、篡改文本或错误消息。

每个临时目录由测试清理，真实全局目录未变。

实际证据：`node --test tests/claude-adapter.test.mjs` 当前 11/11 通过；`node --check scripts/install-claude-adapter.mjs` 通过。

- [x] **步骤 5：提交 Claude 安装器**

```bash
git add adapters/claude/global-policy.md scripts/install-claude-adapter.mjs tests/claude-adapter.test.mjs
git commit -m "feat: add managed Claude fast path policy"
```

实际证据：已提交 `551bfac`、`625a8de`、`1989279`、`d6f9371`、`f1a2e6d`。

### 任务 4：加入双端版本和试点验收

**文件：**
- 修改：`.claude-plugin/plugin.json`
- 修改：`.claude-plugin/marketplace.json`
- 新建：`docs/high-throughput-pilot.md`
- 修改：`docs/README.md`
- 测试：`tests/catalog.test.mjs`、`tests/codex-adapter.test.mjs`、`tests/claude-adapter.test.mjs`

- [x] **步骤 1：写试点文档的失败断言**

在 `tests/catalog.test.mjs` 添加：

```js
test("documents fast path, investigation, and worktree pilots", () => {
  const source = fs.readFileSync(path.join(root, "docs", "high-throughput-pilot.md"), "utf8");
  for (const heading of ["## 快路径", "## 只读调研", "## 隔离实现"]) {
    assert.match(source, new RegExp(heading));
  }
  assert.match(source, /不以耗时宣称代替实际证据/);
});
```

- [x] **步骤 2：确认 RED**

运行：

```bash
node --test tests/catalog.test.mjs
```

预期：因 `docs/high-throughput-pilot.md` 不存在而失败。

实际证据：`node --test tests/catalog.test.mjs` 共 9 项，8 通过、1 失败；新增断言因该文件不存在而报 `ENOENT`。

- [x] **步骤 3：添加试点与升级版本**

创建 `docs/high-throughput-pilot.md`，包含：

```md
## 快路径

在合成 Git 仓库中修改一个已点名函数并运行唯一相关测试。记录读取文件、修改文件和测试命令；不创建计划、代理或 worktree。

## 只读调研

让 `repo-explorer` 只读取三份已点名文件。记录其证据，并以 `git diff --exit-code` 证明没有改动。

## 隔离实现

在合成仓库创建子 worktree，由 `implementer` 修改两份指定文件并运行目标测试；验证父检出仍干净。

不以耗时宣称代替实际证据。任何未返回的非交互 CLI 调用都记录为限制，而非成功。
```

将两个插件清单版本从 `0.5.0` 改为 `0.6.0`，并在 `docs/README.md` 添加本计划和试点文档链接。

- [x] **步骤 4：运行完整源码验证**

运行：

```bash
node --test tests/*.test.mjs
node --check scripts/install-codex-adapter.mjs
node --check scripts/install-claude-adapter.mjs
claude plugin validate .claude-plugin/plugin.json
git diff --check
```

预期：全部测试通过，两个 Node 脚本语法正确，插件清单有效且无空白错误。

实际证据：`node --test tests/*.test.mjs` 35/35 通过；两个 `node --check` 均通过；`claude plugin validate .claude-plugin/plugin.json` 通过；`git diff --check` 通过。未返回的 CLI 不作为成功记录。

- [x] **步骤 5：提交发布准备**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json docs/high-throughput-pilot.md docs/README.md tests/catalog.test.mjs
git commit -m "docs: add high-throughput delivery pilots"
```

实际证据：失败测试已提交为 `2bee8ac`（`test: define high-throughput pilot contract`）；本任务的文档、清单与完整验证将作为上述提交交付。

### 任务 5：在真实全局目录安装并记录证据

**文件：**
- 修改：`docs/pilot-results.md`
- 不纳入源码：`/Users/leon/.codex/AGENTS.md`、`/Users/leon/.claude/CLAUDE.md` 及其受管清单

- [ ] **步骤 1：备份与预检真实目标**

运行：

```bash
backup_root="/Users/leon/.codex/backups/high-throughput-20260803"
mkdir -p "$backup_root"
cp /Users/leon/.codex/AGENTS.md "$backup_root/AGENTS.md.before"
cp /Users/leon/.claude/CLAUDE.md "$backup_root/CLAUDE.md.before"
node scripts/install-codex-adapter.mjs --verify-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
```

预期：备份文件存在；两个 Codex 验证命令在写入前给出当前有效状态或明确漂移原因。若存在漂移，停止并报告，不覆盖。

- [ ] **步骤 2：安装双端策略和 Codex 技能**

运行：

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --install --target /Users/leon/.codex/skills
node scripts/install-claude-adapter.mjs --install --claude-home /Users/leon/.claude
claude plugin update leon-engineering@leon-local --scope user
claude plugin enable leon-engineering@leon-local --scope user
```

预期：三份受管清单写入并声明 `0.6.0`；Claude 插件更新后显示启用。成功安装 CLI 的 stdout 仅返回安全摘要（Claude 为 `{installed:true, frameworkVersion}`；Codex 全局安装为 `{installed:true, documents, frameworkVersion}`），不得输出清单、前后缀、用户文本、路径或 `sourceCommit`，stderr 成功日志也不得包含用户内容。任何冲突、漂移或插件更新失败均停止，不手工覆盖。

- [ ] **步骤 3：最终双端验证与试点**

运行：

```bash
node scripts/install-codex-adapter.mjs --verify-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
node scripts/install-claude-adapter.mjs --verify --claude-home /Users/leon/.claude
claude plugin details leon-engineering@leon-local
```

随后按 `docs/high-throughput-pilot.md` 运行三种合成夹具，并记录实际命令、差异检查、目标测试和非交互限制。不得把未返回的模型调用记录为通过。

- [ ] **步骤 4：记录结果并提交**

在 `docs/pilot-results.md` 增加中文条目，记录：源码提交、插件与两份策略的版本、三条试点的实际证据、未验证项以及 Claude Code 重启要求。然后运行：

```bash
git add docs/pilot-results.md
git commit -m "docs: record high-throughput protocol activation"
```

## 计划自检

- 规范中的默认快路径、任务契约、正向路由、明确升级、双端等价安装、版本一致性、三条夹具和非目标，分别由任务 1 至 5 覆盖。
- 所有实现路径、导出函数、CLI 参数、清单字段、测试命令和文件路径均在前述任务中定义。
- 本计划不包含占位项、自动网络安装、自动发布、自动推送或针对无关项目的扫描。
