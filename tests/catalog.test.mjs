import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {SKILL_NAMES} from "../scripts/install-codex-adapter.mjs";
import {buildReconciliation, buildPluginAdditions} from "../scripts/sync-cc-switch-skills.mjs";

const root = path.resolve(import.meta.dirname, "..");

const skills = {
  "project-bootstrap": ["project instructions", "CI"],
  "feature-loop": ["acceptance criteria", "worktree"],
  "bugfix-evidence": ["reproduce", "root cause"],
  "review-ship": ["diff", "handoff"],
  "logging-observability": ["structured", "redact"],
  "agent-routing": ["worktree", "agent team"],
  "skill-health": ["overlap", "Never delete"],
  "project-adapter": ["read-only", "candidate"],
  "project-harness": ["handoff", "--write-harness"],
  "project-constraints": ["read-only", "--changed-file"],
  "iteration-delivery": ["default branch", "cleanup"],
  "socratic-clarification": ["Triggers", "Anti-triggers", "Observable output"],
  "dual-layer-explanation": ["Triggers", "Anti-triggers", "Observable output"],
  "reverse-engineering": ["Triggers", "Anti-triggers", "Observable output"],
  "horizontal-vertical-analysis": ["Triggers", "Anti-triggers", "Observable output"],
  "fact-checking": ["Triggers", "Anti-triggers", "Observable output"],
  "expert-perspectives": ["Triggers", "Anti-triggers", "Observable output"],
  "first-principles": ["Triggers", "Anti-triggers", "Observable output"],
  "cross-domain-transfer": ["Triggers", "Anti-triggers", "Observable output"],
  "steelman-comparison": ["Triggers", "Anti-triggers", "Observable output"],
  "minimal-experiment": ["Triggers", "Anti-triggers", "Observable output"]
};

const agents = {
  "repo-explorer": {model: "haiku", readOnly: true},
  planner: {model: "sonnet", readOnly: true},
  implementer: {model: "sonnet", worktree: true},
  "code-reviewer": {model: "sonnet", readOnly: true},
  "security-reviewer": {model: "opus", readOnly: true},
  "ci-triage": {model: "haiku", readOnly: true},
  "docs-mapper": {model: "haiku", readOnly: true}
};

function readSkill(name) {
  return fs.readFileSync(path.join(root, "skills", name, "SKILL.md"), "utf8");
}

function readAgent(name) {
  return fs.readFileSync(path.join(root, "agents", `${name}.md`), "utf8");
}

function readPolicy(name) {
  return fs.readFileSync(path.join(root, "adapters", name, "global-policy.md"), "utf8");
}

function readSharedPolicy() {
  return fs.readFileSync(path.join(root, "adapters", "shared", "global-policy.md"), "utf8");
}

function readEffectivePolicy(host) {
  return `${readSharedPolicy()}\n${readPolicy(host)}`;
}

test("separates shared engineering principles from host-specific policy deltas", () => {
  const shared = readSharedPolicy();
  const codex = readPolicy("codex");
  const claude = readPolicy("claude");

  for (const phrase of ["目标与约束", "事实与假设", "证据闭环", "系统边界", "期望效用", "不确定性", "反馈", "思考深度"]) {
    assert.match(shared, new RegExp(phrase));
  }
  for (const method of [
    "socratic-clarification", "dual-layer-explanation", "reverse-engineering", "horizontal-vertical-analysis",
    "fact-checking", "expert-perspectives", "first-principles", "cross-domain-transfer",
    "steelman-comparison", "minimal-experiment"
  ]) assert.match(shared, new RegExp(method));
  assert.match(codex, /Codex.*PreToolUse.*PostToolUse.*Hook/);
  assert.match(claude, /^\{\{LEON_ENGINEERING_SHARED_POLICY_IMPORT\}\}/m);
  assert.doesNotMatch(claude, /目标与约束|期望效用|first-principles/);
});

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "expected YAML frontmatter");
  return Object.fromEntries(match[1].split("\n").flatMap(line => {
    const field = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/);
    return field ? [[field[1], field[2]]] : [];
  }));
}

test("ships the focused workflow skills", () => {
  assert.deepEqual(
    fs.readdirSync(path.join(root, "skills")).sort(),
    Object.keys(skills).sort()
  );

  for (const [name, phrases] of Object.entries(skills)) {
    const source = readSkill(name);
    const meta = frontmatter(source);
    assert.equal(meta.name, name);
    assert.match(meta.description, /Use when /);
    for (const phrase of phrases) assert.match(source, new RegExp(phrase, "i"));
  }
});

test("ships seven bounded agents without recursive delegation", () => {
  assert.deepEqual(
    fs.readdirSync(path.join(root, "agents")).sort(),
    Object.keys(agents).map(name => `${name}.md`).sort()
  );

  for (const [name, expectation] of Object.entries(agents)) {
    const source = readAgent(name);
    const meta = frontmatter(source);
    assert.equal(meta.name, name);
    assert.equal(meta.model, expectation.model);
    assert.match(meta.description, /^(Explore|Produce|Implement|Review|Assess|Classify|Map) /);
    assert.match(source, /Do not .*delegate/i);
    assert.match(source, /verified|evidence/i);

    if (expectation.readOnly) {
      assert.match(meta.disallowedTools, /Write/);
      assert.match(meta.disallowedTools, /Edit/);
      assert.match(meta.disallowedTools, /Agent/);
    }
    if (expectation.worktree) {
      assert.equal(meta.isolation, "worktree");
      assert.match(meta.disallowedTools, /Agent/);
      assert.match(source, /acceptance criteria/i);
    }
  }
});

test("documents one focused pilot scenario for every new workflow and agent", () => {
  const source = fs.readFileSync(path.join(root, "docs", "expansion-pilot.md"), "utf8");
  for (const name of [...Object.keys(skills), ...Object.keys(agents)]) {
    assert.match(source, new RegExp(`### ${name}\\b`));
  }
  assert.match(source, /No agent may delegate/i);
  assert.match(source, /do not use production credentials/i);
});

test("documents Codex role templates with explicit boundaries", () => {
  const source = fs.readFileSync(
    path.join(root, "skills", "agent-routing", "references", "codex-role-templates.md"),
    "utf8"
  );
  for (const name of Object.keys(agents)) assert.match(source, new RegExp(`## ${name}\\b`));
  assert.match(source, /Never create a nested agent/);
  assert.match(source, /parent checkout remains clean/);
});

test("keeps the Codex adapter aligned with the focused skill catalog", () => {
  assert.deepEqual([...SKILL_NAMES].sort(), Object.keys(skills).sort());
});

test("defines a stable project profile schema", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(root, "adapters", "codex", "project-profile-schema.json"),
    "utf8"
  ));
  assert.deepEqual(
    schema.required,
    [
      "schemaVersion",
      "projectRoot",
      "instructions",
      "ecosystems",
      "commands",
      "ci",
      "platformSignals",
      "evidence",
      "uncertainties"
    ]
  );
  assert.equal(schema.properties.commands.items.properties.status.const, "candidate");
  assert.deepEqual(schema.properties.commands.items.required, [
    "kind", "verifierId", "command", "argv", "workingDirectory", "source", "interactive", "status"
  ]);
  assert.equal(schema.properties.commands.items.properties.interactive.const, false);
  assert.equal(schema.properties.commands.items.properties.workingDirectory.type, "string");
  assert.equal(schema.properties.commands.items.properties.argv.items.type, "string");
});

test("routes work through four mechanical risk tiers without auto-publishing narrow edits", () => {
  const shared = readSharedPolicy();
  const policy = readEffectivePolicy("codex");
  const routing = readSkill("agent-routing");

  assert.match(shared, /\| 只读快路径 \|[^\n]*\| `read-only` \|/);
  assert.match(shared, /\| 窄小改本地环 \|[^\n]*\| `local-only` \|/);
  assert.match(shared, /\| 中高风险隔离实现 \|[^\n]*\| `isolated` \|/);
  assert.match(shared, /\| 明确发布\/高风险完整交付 \|[^\n]*\| `full-delivery` \|/);
  assert.match(policy, /窄小改.*局部、可逆.*公开接口.*schema.*依赖.*CI.*数据库.*桌面.*并发冲突/s);
  assert.match(policy, /窄小改本地环.*本地验证.*Harness.*不伪造远端 receipt/s);
  assert.doesNotMatch(shared.match(/^\| 窄小改本地环 \|.*$/m)?.[0] ?? "", /iteration-delivery|delivery-required|require-delivery/);
  assert.match(policy, /明确发布\/高风险完整交付.*`--delivery-required`.*`--require-delivery`/s);
  assert.equal((shared.match(/--delivery-required/g) ?? []).length, 1);
  assert.equal((shared.match(/--require-delivery/g) ?? []).length, 1);
  assert.match(routing, /只有在.*明确速度收益.*时才派发代理/);
  assert.match(routing, /不得为了流程而向用户提问/);
});

test("caps model-visible tool receipts without weakening evidence gates", () => {
  const shared = readSharedPolicy();
  const codex = readPolicy("codex");

  assert.ok(Buffer.byteLength(shared) + Buffer.byteLength(codex) <= 4400);
  assert.match(shared, /独立只读检查.*同轮批量执行/);
  assert.match(shared, /普通工具回执.*≤4\s*KiB/);
  assert.match(shared, /宽查询.*8,000\s*字符/);
  assert.match(shared, /全文留在本地.*摘要.*SHA-256.*定点回查/s);
  assert.match(shared, /不重复读取相同输出/);
  assert.match(shared, /CI\/线程.*状态变化.*超时.*需要操作/s);
  assert.match(shared, /不得.*省略错误.*`\|\| true`.*减少必需验收.*Token/s);
  assert.match(shared, /秘密.*依赖.*授权/s);
  assert.match(shared, /真实.*平台硬门/s);
});

test("keeps Harness delivery documentation scoped to the full-delivery tier", () => {
  const harness = fs.readFileSync(path.join(root, "docs", "harness-v1.md"), "utf8");

  assert.doesNotMatch(harness, /实现任务加 `--require-delivery`/);
  assert.match(harness, /完整交付.*`--delivery-required`.*`--require-delivery`/s);
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

test("documents fast path, investigation, and worktree pilots", () => {
  const source = fs.readFileSync(path.join(root, "docs", "high-throughput-pilot.md"), "utf8");
  for (const heading of ["## 快路径", "## 只读调研", "## 隔离实现"]) {
    assert.match(source, new RegExp(heading));
  }
  assert.match(source, /不以耗时宣称代替实际证据/);
});

test("checks installed capabilities before choosing the execution route", () => {
  const codexPolicy = readEffectivePolicy("codex");
  const claudePolicy = readEffectivePolicy("claude");
  const gettingStarted = fs.readFileSync(
    path.join(root, "adapters", "codex", "global-docs", "GETTING_STARTED.md"),
    "utf8"
  );
  const skillsGuide = fs.readFileSync(
    path.join(root, "adapters", "codex", "global-docs", "SKILLS_GUIDE.md"),
    "utf8"
  );
  const routing = readSkill("agent-routing");

  assert.match(codexPolicy, /优先检查已安装的 skill、agent 和工具/);
  assert.match(claudePolicy, /优先检查已安装的 skill、agent 和工具/);
  assert.match(gettingStarted, /已安装能力/);
  assert.match(skillsGuide, /发现外部候选不等于安装/);
  assert.match(skillsGuide, /project-harness/);
  assert.match(routing, /不能把未检查可用能力合理化为直接执行/);
});

test("persists proactive framework corrections instead of leaving them in chat", () => {
  const policy = readEffectivePolicy("codex");

  assert.match(policy, /主动提炼跨项目可复用的错误和经验/);
  assert.match(policy, /自动更新受管源、测试和安装副本/);
  assert.match(policy, /受管源、测试和安装副本/);
});

test("proactively promotes low-risk reusable framework learning", () => {
  const codexPolicy = readEffectivePolicy("codex");
  const claudePolicy = readEffectivePolicy("claude");
  const gettingStarted = fs.readFileSync(
    path.join(root, "adapters", "codex", "global-docs", "GETTING_STARTED.md"),
    "utf8"
  );
  const routing = readSkill("agent-routing");
  const learning = fs.readFileSync(path.join(root, "docs", "framework-learning.md"), "utf8");

  for (const policy of [codexPolicy, claudePolicy]) {
    assert.match(policy, /主动提炼跨项目可复用的错误和经验/);
    assert.match(policy, /低风险.*自动/);
    assert.match(policy, /高风险.*明确确认/);
  }
  assert.match(gettingStarted, /框架学习/);
  assert.match(routing, /不等待用户再次指出/);
  for (const heading of ["## 触发条件", "## 自动推广", "## 升级确认", "## 记录格式"]) {
    assert.match(learning, new RegExp(heading));
  }
  assert.match(learning, /不记录项目特定的事实/);
});

test("requires automatic Harness start and a cross-host delivery hard gate", () => {
  const codexPolicy = readEffectivePolicy("codex");
  const claudePolicy = readEffectivePolicy("claude");
  const harness = readSkill("project-harness");
  const commands = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");

  assert.match(codexPolicy, /自动开始 Harness/);
  assert.match(codexPolicy, /Codex.*PreToolUse.*PostToolUse.*Hook/);
  assert.match(claudePolicy, /自动开始 Harness/);
  assert.match(harness, /Codex.*PreToolUse.*PostToolUse.*Hook/);
  assert.match(harness, /harness-session\.mjs/);
  assert.match(harness, /harness-enforce\.mjs/);
  assert.match(commands, /交付硬门/);
});

test("documents observed verifier execution without changing the Codex tool schema", () => {
  const harness = fs.readFileSync(path.join(root, "skills", "project-harness", "SKILL.md"), "utf8");
  const commands = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");
  const harnessDoc = fs.readFileSync(path.join(root, "docs", "harness-v1.md"), "utf8");

  for (const content of [harness, commands, harnessDoc]) {
    assert.match(content, /harness-run\.mjs/);
    assert.match(content, /verifier ID/i);
    assert.match(content, /8\s*KiB/i);
    assert.match(content, /6\s*KiB/i);
    assert.match(content, /observation_recorded/);
    assert.match(content, /observation_recalled/);
  }
  assert.match(harness, /runObserved\(spec\)/);
  assert.match(harness, /readObservation\(query\)/);
  assert.match(commands, /functions\.exec/);
  assert.match(commands, /补丁成功.*verifier/s);
  assert.match(commands, /原生 `exec_command`/);
  assert.match(commands, /不新增工具 schema/);
});

test("documents the Codex host restart boundary after global hook installation", () => {
  const commands = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");

  assert.match(commands, /Codex.*宿主进程.*重启/s);
  assert.match(commands, /新建任务.*不会.*刷新/s);
});

test("governs the audited Claude catalog through explicit shared boundaries", () => {
  const codexPolicy = readEffectivePolicy("codex");
  const claudePolicy = readEffectivePolicy("claude");
  const agentGuide = fs.readFileSync(
    path.join(root, "adapters", "codex", "global-docs", "AGENTS_GUIDE.md"),
    "utf8"
  );
  const routing = readSkill("agent-routing");
  const catalog = fs.readFileSync(path.join(root, "docs", "shared-capability-catalog.md"), "utf8");

  for (const policy of [codexPolicy, claudePolicy]) {
    assert.match(policy, /共享能力目录/);
    assert.match(policy, /不在共享目录/);
    assert.match(policy, /skill.*同步.*文档/);
    assert.match(policy, /Python.*依赖/);
  }
  assert.match(agentGuide, /七个规范职责代理/);
  assert.match(routing, /不把 Claude 专用 agent 或 skill 隐式当成共享能力/);
  for (const phrase of ["52 个", "51 个", "230 个", "11 个工程工作流", "10 个推理 Skill", "iteration-delivery", "project-constraints", "project-harness", "first-principles", "minimal-experiment", "ecc", "zq", "data-connector-development", "## 共享工作流", "## 共享推理 Skill", "## Claude 专用排除项"]) {
    assert.match(catalog, new RegExp(phrase));
  }
});

test("reconciles CC-Switch flags from active directories and the enabled framework plugin", () => {
  const result = buildReconciliation({
    rows: [
      {id: "local:zq", directory: "zq", enabled_claude: 1, enabled_codex: 0},
      {id: "local:data-connector-development", directory: "data-connector-development", enabled_claude: 1, enabled_codex: 1},
      {id: "local:feature-loop", directory: "feature-loop", enabled_claude: 0, enabled_codex: 1},
      {id: "local:project-adapter", directory: "project-adapter", enabled_claude: 0, enabled_codex: 1},
      {id: "local:document", directory: "document", enabled_claude: 0, enabled_codex: 0}
    ],
    claudeDirectories: new Set(["data-connector-development", "document"]),
    codexDirectories: new Set(["feature-loop"]),
    pluginEnabled: true
  });

  assert.deepEqual(result.counts, {claude: 4, codex: 1});
  assert.deepEqual(result.changes, [
    {id: "local:zq", before: {claude: 1, codex: 0}, after: {claude: 0, codex: 0}},
    {id: "local:data-connector-development", before: {claude: 1, codex: 1}, after: {claude: 1, codex: 0}},
    {id: "local:feature-loop", before: {claude: 0, codex: 1}, after: {claude: 1, codex: 1}},
    {id: "local:project-adapter", before: {claude: 0, codex: 1}, after: {claude: 1, codex: 0}},
    {id: "local:document", before: {claude: 0, codex: 0}, after: {claude: 1, codex: 0}}
  ]);
});

test("adds a missing enabled framework workflow to the CC-Switch catalog", () => {
  assert.deepEqual(buildPluginAdditions({
    rows: [{id: "local:agent-routing", directory: "agent-routing"}],
    pluginSkills: ["agent-routing", "project-harness"],
    pluginEnabled: true,
    claudeDirectories: new Set(),
    codexDirectories: new Set(["project-harness"])
  }), [{
    id: "local:project-harness",
    name: "project-harness",
    directory: "project-harness",
    enabledClaude: 1,
    enabledCodex: 1
  }]);
});
