# Harness v1 交付评估闭环实施计划

> **面向代理执行者：**必须使用 `executing-plans`，按任务逐项实施本计划；步骤使用复选框（`- [ ]`）记录状态。

**目标：**让用户明确选择项目的 Harness 能以只读方式汇总真实交付证据，并从此记录验证耗时与阻塞分类，计算一次通过率、澄清轮次、返工、验证耗时和数据覆盖率。

**架构：**保持 `harness-project.mjs` 的任务创建与结果写入边界不变，仅为 outcome 增加显式、可验证的度量字段。新增 `harness-evaluate.mjs`，只读取一个项目内安全的 `.ai/harness/tasks/*.json`，绝不运行任务命令、访问网络或创建文件；它返回稳定 JSON 或 Markdown 汇总。报告把缺失的时长/阻塞数据明确算入覆盖率，避免把历史记录误称为完整数据。

**技术栈：**Node.js 内置 `node:test`、`fs`、`path`、JSONL/JSON、现有受限项目画像与 Harness 路径安全机制。

---

## 文件结构

| 文件 | 操作 | 职责 |
| --- | --- | --- |
| `scripts/harness-project.mjs` | 修改 | 记录可选的实际验证耗时，以及 blocked 结果的阻塞分类。 |
| `scripts/harness-evaluate.mjs` | 新建 | 安全读取单个项目的 Harness 任务记录，计算可复算汇总并提供 CLI。 |
| `tests/harness-project.test.mjs` | 修改 | 锁定新 outcome 字段与 CLI 参数的验证行为。 |
| `tests/harness-evaluate.test.mjs` | 新建 | 覆盖只读汇总、一次通过口径、缺失指标覆盖率与符号链接拒绝。 |
| `skills/project-harness/SKILL.md` | 修改 | 指明何时运行只读评估，以及不得伪造时长/阻塞证据。 |
| `docs/harness-v1.md` | 修改 | 记录指标定义、历史数据边界和不升级为编排系统的条件。 |
| `adapters/codex/global-docs/COMMANDS_GUIDE.md` | 修改 | 加入两宿主可用的评估命令。 |
| `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` | 修改 | 将共享 workflow 版本升级为 `0.8.0`。 |
| `docs/pilot-results.md` | 修改 | 仅在真实安装、校验和项目评估预览完成后记录证据。 |

### Task 1: 先为只读评估器写失败测试

**Files:**
- Create: `tests/harness-evaluate.test.mjs`

- [x] **Step 1: 写入两任务 fixture 的失败测试**

```js
import {evaluateHarness, formatEvaluation} from "../scripts/harness-evaluate.mjs";

test("summarizes one first-pass task and one blocked task without writing project state", t => {
  const project = makeHarnessFixture(t);
  const before = fs.readFileSync(path.join(project, ".ai", "harness", "metrics.jsonl"), "utf8");
  const result = evaluateHarness({projectRoot: project});
  assert.deepEqual(result.summary, {
    taskCount: 2,
    terminalTaskCount: 2,
    completedPassedCount: 1,
    firstPassCompletedCount: 1,
    firstPassRate: 0.5,
    averageClarificationRounds: 1,
    averageReworkCount: 0.5,
    verificationDurationCoverage: 0.5,
    averageVerificationDurationSeconds: 12,
    blockerCategories: {environment: 1}
  });
  assert.match(formatEvaluation(result, "markdown"), /一次通过率.*50%/);
  assert.equal(fs.readFileSync(path.join(project, ".ai", "harness", "metrics.jsonl"), "utf8"), before);
});
```

- [x] **Step 2: 运行测试并确认因模块不存在失败**

Run: `node --test tests/harness-evaluate.test.mjs`

Expected: FAIL，错误明确为找不到 `scripts/harness-evaluate.mjs`，而非 fixture 或断言错误。

### Task 2: 实现安全、只读的评估器

**Files:**
- Create: `scripts/harness-evaluate.mjs`
- Modify: `tests/harness-evaluate.test.mjs`

- [x] **Step 1: 实现最小 API 和安全读取**

```js
export function evaluateHarness({projectRoot}) {
  const root = buildProfile({projectRoot}).projectRoot;
  const directory = existingSafeDirectory(root, HARNESS_DIRECTORY);
  if (!directory) throw new Error("missing task harness");
  const tasks = existingSafeDirectory(root, `${HARNESS_DIRECTORY}/tasks`);
  return summarize(readTaskRecords(tasks));
}
```

`readTaskRecords` 只能读取普通 `.json` 文件，跳过无 outcome 的 ready 任务，不得跟随符号链接；无效 JSON 或非法 outcome 必须失败。`summarize` 以每个任务最后一条 outcome 为终态；一次通过的精确定义为“唯一 outcome 为 `completed` 且验证状态为 `passed` 且 `reworkCount` 为 0”。

- [x] **Step 2: 实现 CLI，但不写报告文件**

```bash
node scripts/harness-evaluate.mjs --project /absolute/project --format json
node scripts/harness-evaluate.mjs --project /absolute/project --format markdown
```

CLI 只允许 `--project` 与可选 `--format json|markdown`；未知参数、缺失 Harness、目录符号链接和无效记录均以非零退出。不得增加 `--write`、不得执行任务记录中的验证命令。

- [x] **Step 3: 扩展测试并验证 GREEN**

添加 CLI JSON/Markdown、无 Harness、符号链接 tasks 目录及空 outcome 任务测试。

Run: `node --test tests/harness-evaluate.test.mjs`

Expected: PASS，且断言评估前后 `metrics.jsonl` 字节完全相同。

### Task 3: 让新结果拥有完整、诚实的指标字段

**Files:**
- Modify: `tests/harness-project.test.mjs`
- Modify: `scripts/harness-project.mjs`

- [x] **Step 1: 先写失败测试**

为 `recordOutcome` 增加期望：

```js
verificationDurationSeconds: 12,
blockerCategory: "environment"
```

并断言：`verificationDurationSeconds` 只能是非负整数；`status === "blocked"` 时必须为 `environment|dependency|permission|requirements|test|external|unknown` 之一；非 blocked 结果不得伪造 blocker 分类。CLI 同样接受 `--verification-duration-seconds` 与 `--blocker-category`。

- [x] **Step 2: 运行失败测试**

Run: `node --test tests/harness-project.test.mjs`

Expected: FAIL，因为新字段尚未保留或 CLI 尚未解析。

- [x] **Step 3: 实现最小输入校验和记录**

在 outcome 记录中只保存调用方显式传入的非负验证秒数；该值描述已执行命令的实测耗时，不得由脚本猜测。仅 blocked 记录 blocker 分类。保留旧记录兼容性：旧 outcome 无这两个字段仍可评估，但报告将其纳入“未记录覆盖率”。

- [x] **Step 4: 运行目标测试**

Run: `node --test tests/harness-project.test.mjs tests/harness-evaluate.test.mjs`

Expected: PASS。

### Task 4: 更新共享 workflow 与中文文档

**Files:**
- Modify: `skills/project-harness/SKILL.md`
- Modify: `docs/harness-v1.md`
- Modify: `adapters/codex/global-docs/COMMANDS_GUIDE.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [x] **Step 1: 对改动后的 skill 运行压力场景**

场景：用户要求评价一个已有 Harness。合格行为必须先运行 `harness-evaluate.mjs` 的只读命令，报告覆盖率并区分历史缺字段，不能创建第二个 Harness、补写历史时长或运行记录中的验证命令。

- [x] **Step 2: 写入简明 workflow 和中文文档**

Skill 保持触发条件不变，新增只读评估示例，并声明只有执行者能记录已实际测得的秒数与 blocked 分类。文档定义指标与一次通过口径；写明“指标不足时先提升数据覆盖率，不据此启用编排层”。命令指南写入 JSON/Markdown 两条只读示例。插件两个版本字段同步为 `0.8.0`。

- [x] **Step 3: 运行 catalog 与技能静态验证**

Run: `node --test tests/catalog.test.mjs && claude plugin validate .claude-plugin/plugin.json`

Expected: PASS，且 plugin manifest 合法。

### Task 5: 完整验证、实际安装与试点评估预览

**Files:**
- Modify: `docs/pilot-results.md`

- [x] **Step 1: 全量验证**

Run:

```bash
node --test tests/*.test.mjs
node --check scripts/harness-project.mjs
node --check scripts/harness-evaluate.mjs
node --check scripts/install-codex-adapter.mjs
node --check scripts/sync-cc-switch-skills.mjs
claude plugin validate .claude-plugin/plugin.json
git diff --check
```

Expected: 全部通过。

- [x] **Step 2: 安装到两个宿主并验证漂移**

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --verify-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --install --target /Users/leon/.codex/skills
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
claude plugin update leon-engineering@leon-local --scope user
node scripts/install-claude-adapter.mjs --install --claude-home /Users/leon/.claude
node scripts/install-claude-adapter.mjs --verify --claude-home /Users/leon/.claude
```

Expected: 两端适配器无 drift；若 Claude 需要重启，明确记录为未在本会话验证的 UI 激活项。

- [x] **Step 3: 对 AlphaFoundry 执行只读评估预览**

Run: `node scripts/harness-evaluate.mjs --project /Users/leon/Desktop/Projects/AlphaFoundry --format markdown`

Expected: 只读取现有 `.ai/harness`，并诚实显示历史 pilot 缺少新时长字段的覆盖率；不得把它当成业务任务速度结论。

- [x] **Step 4: 记录实际证据、提交与合并**

仅写入实际执行过的命令和结果；不记录未跑的第二项目业务任务。提交后 fast-forward 合并到 `main`，再清理该隔离 worktree。

## 计划自检

- 覆盖：新增口径、只读汇总、输入安全、历史兼容、Skill/文档、两端安装、AlphaFoundry 只读试点评估均有对应任务。
- 无占位符：每个实现与验证步骤均包含目标文件、命令、输入或行为边界。
- 一致性：评估器以最后 outcome 为终态；一次通过定义与 `reworkCount`、验证状态和唯一 outcome 条件一致；历史缺字段通过覆盖率显示，而非推断。
