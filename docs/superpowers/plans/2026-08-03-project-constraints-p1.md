# P1：项目机械约束实施计划

> **面向代理执行者：**必须使用 `executing-plans` 按任务逐项实施；复选框记录真实进度。

**目标：**让项目把架构、文档联动、日志/错误处理和桌面平台约束声明为受版本控制的 JSON，并以一个不执行项目命令的检查器输出可供 CI 使用的非零退出码和 JSON 结果。

**架构：**新增 `project-constraints.mjs`，只读取用户选择项目内的 `.agents/project-constraints.json` 和被该配置点名的文件。检查器不猜测项目规则、不调用 Git、不运行测试、也不写项目；调用方可显式传入本次变更的相对路径，使 CI 以“变更文件 → 约束”执行。声明包含必需文件、变更文档联动、内容模式和 CI 工作流文本要求。随后在 AlphaFoundry 的独立 worktree 中添加受跟踪配置，并把同一个只读命令接入现有 CI。

**技术栈：**Node.js 内置模块与 `node:test`、JSON、GitHub Actions、现有 Codex/Claude 安装器。

---

## 文件结构

| 文件 | 操作 | 职责 |
| --- | --- | --- |
| `scripts/project-constraints.mjs` | 新建 | 解析受限配置，验证必需文件、变更联动、内容模式和 CI 文本约束。 |
| `scripts/install-project-constraints.mjs` | 新建 | 仅在明确授权后，将同一检查器复制为项目受跟踪的 CI 副本。 |
| `tests/project-constraints.test.mjs` | 新建 | 覆盖只读、失败报告、路径安全、变更联动及 CLI 退出码。 |
| `tests/project-constraints-install.test.mjs` | 新建 | 覆盖预览、显式安装、替换拒绝和符号链接防护。 |
| `skills/project-constraints/SKILL.md` | 新建 | 触发条件、配置写入授权和 CI 使用边界。 |
| `scripts/install-codex-adapter.mjs`、`tests/catalog.test.mjs` | 修改 | 将第十个共享 workflow 纳入安装与目录契约。 |
| `adapters/codex/global-docs/*.md`、`docs/project-constraints.md` | 新建/修改 | 中文说明配置和 CI 调用方式。 |
| `.claude-plugin/*.json` | 修改 | 发布 0.9.0。 |
| `AlphaFoundry/.agents/project-constraints.json` | 新建 | AlphaFoundry 的受跟踪项目规则。 |
| `AlphaFoundry/.github/workflows/<现有 CI>` | 修改 | 在 Python/桌面相关 CI 中调用同一只读检查器。 |

### Task 1：为声明式检查器写失败测试

**Files:**
- Create: `tests/project-constraints.test.mjs`

- [ ] **Step 1：写入 fixture 和期望 API**

```js
import {checkProjectConstraints} from "../scripts/project-constraints.mjs";

test("reports machine-readable violations without writing or executing project commands", t => {
  const project = makeFixture(t, {
    requiredFiles: ["AGENTS.md", "docs/ARCHITECTURE.md"],
    changeRules: [{sourcePrefixes: ["services/"], requiredDocuments: ["docs/CHANGELOG.md"]}],
    contentRules: [{sourcePrefixes: ["services/"], extensions: [".py"], requireAll: ["get_logger", "except "]}],
    ciRules: [{workflow: ".github/workflows/desktop.yml", requireAll: ["windows-latest", "health"]}]
  });
  const result = checkProjectConstraints({projectRoot: project, changedFiles: ["services/work.py"]});
  assert.deepEqual(result.violations.map(item => item.code), ["required_document_changed", "required_content_missing"]);
  assert.equal(fs.existsSync(path.join(project, "command-must-not-run")), false);
});
```

- [ ] **Step 2：运行并确认失败**

Run: `node --test tests/project-constraints.test.mjs`

Expected: FAIL，原因是 `scripts/project-constraints.mjs` 尚不存在。

### Task 2：实现只读检查器和 CLI

**Files:**
- Create: `scripts/project-constraints.mjs`
- Modify: `tests/project-constraints.test.mjs`

- [ ] **Step 1：实现受限 JSON 配置与安全路径**

配置路径固定为 `.agents/project-constraints.json`，只允许项目根目录内的相对普通文件；绝不跟随配置、规则目标或工作流的符号链接。配置键仅允许 `schemaVersion`、`requiredFiles`、`changeRules`、`contentRules`、`ciRules`；未知或类型错误必须失败。

- [ ] **Step 2：实现四类检查与稳定结果**

返回 `{schemaVersion:1, projectRoot, checkedFiles, violations}`。违反项含稳定 `code`、`rule`、`path` 与中文 `message`。`changeRules` 只在调用方传入的 `--changed-file` 匹配 `sourcePrefixes` 时，要求同批次变更包含任一 `requiredDocuments`；`contentRules` 对匹配文件要求每个 `requireAll` 文本存在；`ciRules` 对点名工作流要求每个文本存在。无违反时退出 0，有违反时 CLI 退出 1。

- [ ] **Step 3：实现 CLI 且不读取 Git 状态**

```bash
node scripts/project-constraints.mjs --project /absolute/project
node scripts/project-constraints.mjs --project /absolute/project --changed-file services/work.py --changed-file docs/CHANGELOG.md
```

未知参数、绝对变更路径、`..` 越界、符号链接和无效 JSON 必须非零失败；结果必须只输出 JSON，且不得执行配置以外的命令。

- [ ] **Step 4：运行目标测试**

Run: `node --test tests/project-constraints.test.mjs`

Expected: PASS，覆盖成功、违反、CLI、只读与符号链接拒绝。

### Task 3：将检查器变成共享 workflow

**Files:**
- Create: `skills/project-constraints/SKILL.md`
- Create: `docs/project-constraints.md`
- Modify: `scripts/install-codex-adapter.mjs`
- Modify: `tests/catalog.test.mjs`
- Modify: `adapters/codex/global-docs/COMMANDS_GUIDE.md`
- Modify: `adapters/codex/global-docs/SKILLS_GUIDE.md`
- Modify: `docs/README.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1：对新 Skill 运行无文档基线场景**

场景：用户要求“把项目规则接入 CI”。合格基线应指出需要项目级配置和用户授权，但当前目录没有 workflow 强制先执行只读检查、区分变更路径或拒绝符号链接的共享 Skill。

- [ ] **Step 2：写入最小中文 Skill 与文档**

Skill 必须要求先读取项目规则，默认只读检查；创建或替换 `.agents/project-constraints.json` 必须取得对该项目的明确授权；CI 只能将变更路径显式传给检查器，不能让检查器自行执行 Git 或项目命令。文档定义四类规则、限制和示例。插件版本同步升至 0.9.0。

- [ ] **Step 3：运行目录和技能验证**

Run: `node --test tests/catalog.test.mjs && claude plugin validate .claude-plugin/plugin.json`

Expected: PASS，第十个 workflow 被安装器和插件发现。

### Task 4：为 CI 提供受管项目副本

**Files:**
- Create: `tests/project-constraints-install.test.mjs`
- Create: `scripts/install-project-constraints.mjs`

- [ ] **Step 1：写入安装器失败测试**

预览 `node scripts/install-project-constraints.mjs --project /absolute/project` 只输出目标 `.agents/project-constraints.mjs` 与源校验和；只有 `--write` 才创建文件。已有副本必须拒绝，除非同时传入 `--replace`；项目目录、`.agents/` 和目标副本任一符号链接都必须拒绝。

- [ ] **Step 2：实现最小受管复制**

安装器只能复制规范 `scripts/project-constraints.mjs` 的字节内容到 `.agents/project-constraints.mjs`，使用原子写入与 0600 权限；不读取 Git、不运行项目命令、不创建或覆盖 JSON 约束配置。默认预览不写入。

- [ ] **Step 3：运行安装器测试**

Run: `node --test tests/project-constraints-install.test.mjs`

Expected: PASS。

### Task 5：在 AlphaFoundry 进行受控 CI 接入

**Files:**
- Create: `/Users/leon/Desktop/Projects/AlphaFoundry/.agents/project-constraints.json`
- Modify: `/Users/leon/Desktop/Projects/AlphaFoundry/.github/workflows/<已确认的 CI 文件>`

- [ ] **Step 1：只读确认 AlphaFoundry 的 CI 入口和约束范围**

读取现有 workflow 与项目规则，确认实际 Windows desktop workflow 文件。配置至少要求 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT_MAP.md`、`docs/AGENT_WORKFLOW.md` 和 `docs/desktop_packaging.md` 存在；对服务层 Python 改动检查既有 `get_logger` 与显式错误处理模式；对桌面路径改动要求同批次更新 `docs/desktop_packaging.md`，并验证 workflow 中存在 `windows-latest` 与健康检查文本。

- [ ] **Step 2：在新的 AlphaFoundry worktree 写入配置与 CI 调用**

先用受管安装器显式复制检查器到 `.agents/project-constraints.mjs`。CI 使用项目自身的 Git 变更命令生成相对文件列表，再将每个路径以 `--changed-file` 传给该受跟踪副本；检查器本身仍不运行 Git。不得把用户主工作区的未提交文件带入该 worktree。

- [ ] **Step 3：执行真实检查与现有相关 CI 静态验证**

Run:

```bash
node /Users/leon/Developer/claude-engineering/scripts/project-constraints.mjs --project /absolute/AlphaFoundry
node /Users/leon/Developer/claude-engineering/scripts/project-constraints.mjs --project /absolute/AlphaFoundry --changed-file services/example.py
```

第一条应通过基础结构和 CI 规则；第二条应因缺少同批次文档或内容模式（按 fixture）报告真实违反。再运行 workflow 所用的配置/测试静态检查，不把未运行的 Windows runner 说成通过。

### Task 6：验证、安装、记录与合并

- [ ] **Step 1：完整框架验证**

Run:

```bash
node --test tests/*.test.mjs
node --check scripts/project-constraints.mjs
node --check scripts/install-codex-adapter.mjs
node --check scripts/sync-cc-switch-skills.mjs
claude plugin validate .claude-plugin/plugin.json
git diff --check
```

- [ ] **Step 2：更新两个宿主并验证**

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --verify-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --install --target /Users/leon/.codex/skills
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
claude plugin update leon-engineering@leon-local --scope user
node scripts/install-claude-adapter.mjs --verify --claude-home /Users/leon/.claude
node scripts/sync-cc-switch-skills.mjs --apply
```

- [ ] **Step 3：提交、合并、清理与记录真实证据**

框架和 AlphaFoundry 各自提交；仅在对应验证实际通过后记录结果。框架合并到 `main` 后再更新全局安装；AlphaFoundry worktree 经验证后快进或保留单独分支，不覆盖主工作区的用户改动。

## 计划自检

- P1 四类目标均有可执行检查：架构/目录、文档联动、日志/错误内容模式、桌面 CI 平台文本。
- 项目规则由受跟踪 JSON 与 CI 调用强制，不依赖全局提示词；检查器不运行项目命令或 Git。
- AlphaFoundry 只能在其隔离 worktree 中新增受控配置与 CI 调用，绝不触碰主工作区的未提交改动。
