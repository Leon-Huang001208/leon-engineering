import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {CORE_SKILL_NAMES, EXTENDED_SKILL_NAMES, SKILL_NAMES} from "../scripts/install-codex-adapter.mjs";
import {buildReconciliation, buildPluginAdditions} from "../scripts/sync-cc-switch-skills.mjs";

const root = path.resolve(import.meta.dirname, "..");

const skills = {
  "project-onboarding": ["read-only|by default", "explicit authorization"],
  "engineering-work": ["acceptance criteria", "reproduce", "root cause"],
  "engineering-delivery": ["diff", "current-task authorization", "PR-only"],
  "logging-observability": ["structured", "redact"],
  "agent-routing": ["worktree", "agent team"],
  "skill-health": ["overlap", "Never delete"],
  "project-harness": ["handoff", "--write-harness"],
  "project-constraints": ["read-only", "--changed-file"],
  "problem-framing": ["only the method", "first-principles"],
  "solution-comparison": ["only the method", "steelman-comparison"],
  "evidence-and-experiments": ["only the method", "fact-checking"]
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
  const family = CORE_SKILL_NAMES.includes(name) ? "leon-engineering-core" : "leon-engineering-workflows";
  return fs.readFileSync(path.join(root, "plugins", family, "skills", name, "SKILL.md"), "utf8");
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

test("keeps shared global policy short and puts specialist methods on demand", () => {
  const shared = readSharedPolicy();
  const codex = readPolicy("codex");
  const claude = readPolicy("claude");

  assert.ok(Buffer.byteLength(shared.trim()) + Buffer.byteLength(codex.trim()) + 2 <= 700);
  assert.match(shared, /项目规则/);
  assert.match(shared, /agent-routing/);
  assert.doesNotMatch(shared, /socratic-clarification|first-principles|--delivery-required/);
  assert.match(codex, /不注册自动 Hook/);
  assert.match(claude, /不注册自动 Hook/);
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
    [...CORE_SKILL_NAMES, ...EXTENDED_SKILL_NAMES].sort(),
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
    path.join(root, "plugins", "leon-engineering-core", "skills", "agent-routing", "references", "codex-role-templates.md"),
    "utf8"
  );
  for (const name of Object.keys(agents)) assert.match(source, new RegExp(`## ${name}\\b`));
  assert.match(source, /Never create a nested agent/);
  assert.match(source, /parent checkout remains clean/);
});

test("keeps the Codex adapter aligned with the focused skill catalog", () => {
  assert.deepEqual([...SKILL_NAMES].sort(), Object.keys(skills).sort());
});

test("splits the plugin catalog into a compatible core and opt-in workflows extension", () => {
  const core = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  const workflows = JSON.parse(fs.readFileSync(
    path.join(root, "plugins", "leon-engineering-workflows", ".claude-plugin", "plugin.json"),
    "utf8"
  ));
  const codexWorkflows = JSON.parse(fs.readFileSync(
    path.join(root, "plugins", "leon-engineering-workflows", ".codex-plugin", "plugin.json"),
    "utf8"
  ));
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));

  assert.equal(core.name, "leon-engineering");
  assert.equal(core.version, "0.19.4");
  assert.deepEqual(core.skills, ["./plugins/leon-engineering-core/skills/"]);
  assert.equal(workflows.name, "leon-engineering-workflows");
  assert.equal(workflows.version, "0.19.4");
  assert.equal(codexWorkflows.version, "0.19.4");
  assert.deepEqual(workflows.skills, ["./skills/"]);
  assert.deepEqual(
    fs.readdirSync(path.join(root, "plugins", "leon-engineering-core", "skills")).sort(),
    [...CORE_SKILL_NAMES].sort()
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, "plugins", "leon-engineering-workflows", "skills")).sort(),
    [...EXTENDED_SKILL_NAMES].sort()
  );
  assert.deepEqual(marketplace.plugins.map(plugin => plugin.name), [
    "leon-engineering",
    "leon-engineering-workflows",
    "leon-engineering-commands"
  ]);
  assert.equal(marketplace.plugins[1].source, "./plugins/leon-engineering-workflows");
  assert.ok(marketplace.plugins.every(plugin => plugin.version === "0.19.4"));
});

test("preserves all retired command identities in a metadata-only compatibility package", () => {
  const pluginRoot = path.join(root, "plugins", "leon-engineering-commands");
  const codex = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const claude = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const commandMap = JSON.parse(fs.readFileSync(path.join(pluginRoot, "command-map.json"), "utf8"));
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  const workReferences = "plugins/leon-engineering-core/skills/engineering-work/references/";
  const reviewReference = "plugins/leon-engineering-core/skills/engineering-delivery/references/review-ship.md";
  const expectedRetired = [
    ...["aside", "build-fix", "feature-dev", "plan", "review-pr"].map(name => ({
      name: `source-command-${name}`,
      reason: "core-covered",
      replacement: name === "aside" ? "none" : name === "build-fix" ? `${workReferences}bugfix-evidence.md`
        : name === "review-pr" ? reviewReference : `${workReferences}feature-loop.md`
    })),
    ...["auto-update", "setup-pm", "skill-health", "evolve", "instinct-export", "instinct-import", "instinct-status", "projects", "promote", "prune", "hookify", "hookify-configure", "hookify-help", "hookify-list", "save-session", "resume-session"].map(name => ({
      name: `source-command-${name}`,
      reason: "legacy-system",
      replacement: name === "skill-health" ? "plugins/leon-engineering-workflows/skills/skill-health/SKILL.md" : "none"
    })),
    ...["cpp-build", "cpp-review", "cpp-test", "flutter-build", "flutter-review", "flutter-test", "go-build", "go-review", "gradle-build", "kotlin-build", "kotlin-test", "python-review", "rust-build", "rust-review", "refactor-clean", "test-coverage", "update-codemaps", "update-docs", "learn", "learn-eval", "skill-create"].map(name => ({
      name: `source-command-${name}`,
      reason: "reference-retained",
      replacement: name.endsWith("-review") ? reviewReference : `${workReferences}engineering-methods.md`
    }))
  ].sort((left, right) => left.name.localeCompare(right.name));

  assert.equal(codex.name, "leon-engineering-commands");
  assert.equal(claude.name, "leon-engineering-commands");
  assert.equal(codex.version, "0.19.4");
  assert.equal(claude.version, "0.19.4");
  for (const manifest of [codex, claude]) {
    assert.match(manifest.description, /retired.*metadata-only/i);
    for (const key of ["skills", "agents", "hooks", "mcpServers", "commands"]) {
      assert.equal(Object.hasOwn(manifest, key), false, `retired package declares ${key}`);
    }
  }
  assert.equal(Object.hasOwn(codex.interface, "capabilities"), false);
  assert.deepEqual(fs.readdirSync(pluginRoot).sort(), [".claude-plugin", ".codex-plugin", "README.md", "command-map.json"]);
  for (const directory of [".claude-plugin", ".codex-plugin"]) {
    assert.deepEqual(fs.readdirSync(path.join(pluginRoot, directory)), ["plugin.json"]);
  }
  assert.equal(commandMap.schemaVersion, 1);
  assert.deepEqual(commandMap.commands, []);
  assert.equal(commandMap.retired.length, 42);
  assert.equal(new Set(commandMap.retired.map(item => item.name)).size, 42);
  assert.deepEqual(commandMap.retired.map(({name, reason, replacement}) => ({name, reason, replacement})), expectedRetired);
  for (const item of commandMap.retired) {
    if (item.replacement === "none") {
      assert.match(item.note, /\S/);
    } else {
      assert.equal(path.isAbsolute(item.replacement), false);
      assert.equal(item.replacement.split("/").includes(".."), false);
      assert.ok(fs.lstatSync(path.join(root, item.replacement)).isFile(), item.replacement);
    }
  }
  assert.deepEqual(commandMap.quarantined, [
    {name: "source-command-hello", reason: "retired-placeholder"},
    {name: "source-command-jira", reason: "missing-jira-integration-capability"}
  ]);
  assert.ok(commandMap.retired.every(item => !["source-command-hello", "source-command-jira"].includes(item.name)));
  const readme = fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8");
  assert.match(readme, /retired.*metadata-only/i);
  for (const name of [...CORE_SKILL_NAMES, ...EXTENDED_SKILL_NAMES]) assert.ok(readme.includes(`\`${name}\``));
  assert.match(readme, /historical.*records/i);
  const entry = marketplace.plugins.find(plugin => plugin.name === "leon-engineering-commands");
  assert.deepEqual(entry, {
    name: "leon-engineering-commands",
    source: "./plugins/leon-engineering-commands",
    description: "Retired metadata-only command compatibility package",
    version: "0.19.4"
  });
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

test("routes risk through the on-demand Skill without automatic ledgers or publication", () => {
  const routing = readSkill("agent-routing");
  const delivery = fs.readFileSync(path.join(root, "plugins/leon-engineering-core/skills/engineering-delivery/references/iteration-delivery.md"), "utf8");
  for (const tier of ["read-only", "local-only", "isolated", "full-delivery"]) assert.ok(routing.includes(`\`${tier}\``));
  assert.match(routing, /local, reversible, conflict-free.*schema.*dependencies.*CI.*database.*security.*desktop.*cross-platform/);
  assert.match(routing, /Focused project checks, no publication/);
  assert.match(routing, /Harness is opt-in/);
  assert.match(routing, /verification-policy\.json.*mandatory checks/s);
  assert.match(routing, /no-push\/read-only\/review-only apply/);
  assert.match(routing, /Unknown impact upgrades verification, not authority/);
  assert.match(routing, /Dependency, remote, migration and release permissions remain separate/);
  assert.match(routing, /不增加流程性提问/);
  assert.match(delivery, /explicitly selects this managed controller/);
  assert.match(delivery, /--delivery-required.*--require-delivery/s);
  assert.match(delivery, /direct push.*PR-only or no-push boundary/s);
  assert.match(delivery, /Never infer standing merge or deletion authorization/);
  assert.match(delivery, /fixed contracts.*CI and platform gates.*NOT_RUN\/BLOCKED/s);
  assert.match(delivery, /Never force-push.*dirty worktrees.*unmerged work/s);
  assert.doesNotMatch(delivery, /standing delivery preference|A direct push is the default/);
});

test("governs automatic continuation and bounded receipts without weakening gates", () => {
  const shared = readSharedPolicy();
  const commands = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");
  const agents = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "AGENTS_GUIDE.md"), "utf8");
  const combined = `${commands}\n${agents}`;
  assert.match(commands, /只读检查批量执行/);
  assert.match(combined, /私有日志.*错误.*退出码.*证据/s);
  assert.match(combined, /重试复用已有进程.*任务.*证据/);
  assert.match(combined, /状态未变化静默/);
  assert.match(combined, /不得隐藏错误/);
  assert.match(combined, /项目自己的 CI、平台和权限门仍保留/);
  assert.doesNotMatch(shared, /一次无变化审计|自动开始/);
});

test("caps model-visible tool receipts without weakening evidence gates", () => {
  const shared = readSharedPolicy();
  const codex = readPolicy("codex");
  const manual = fs.readFileSync(path.join(root, "docs", "harness-v1.md"), "utf8");
  const routing = readSkill("agent-routing");

  assert.ok(Buffer.byteLength(shared.trim()) + Buffer.byteLength(codex.trim()) + 2 <= 700);
  assert.match(manual, /4\s*KiB/i);
  assert.match(manual, /8\s*KiB/i);
  assert.match(manual, /SHA-256/);
  assert.match(manual, /超限时保留头、尾、错误上下文、状态、退出码、超时原因、SHA-256和日志引用/);
  assert.match(manual, /疑似秘密不进入模型可见回执或 `readObservation` 回查/);
  assert.match(manual, /未知路径及公开契约、schema、数据库、依赖、CI、安全、桌面变化只能升级到完整交付，不能手工降级/);
  assert.match(routing, /fixed contracts and platform gates/);
  assert.match(routing, /NOT_RUN\/BLOCKED/);
});

test("keeps Harness delivery documentation scoped to the full-delivery tier", () => {
  const harness = fs.readFileSync(path.join(root, "docs", "harness-v1.md"), "utf8");

  assert.doesNotMatch(harness, /实现任务加 `--require-delivery`/);
  assert.match(harness, /完整交付.*`--delivery-required`.*`--require-delivery`/s);
});

test("keeps fast path documentation aligned", () => {
  const documents = [
    {name: "GETTING_STARTED.md", phrase: /已知单条只读请求不启动完整工程流程/},
    {name: "AGENTS_GUIDE.md", phrase: /全局约定只放跨岗位共用/},
    {name: "COMMANDS_GUIDE.md", phrase: /项目档案.*获准时写入/}
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

  assert.match(codexPolicy, /agent-routing/);
  assert.match(claudePolicy, /agent-routing/);
  assert.match(gettingStarted, /已安装能力/);
  assert.match(skillsGuide, /外部候选.*审查.*获准安装/);
  assert.match(skillsGuide, /project-harness/);
  assert.match(routing, /已安装且匹配的能力.*外部候选不等于可用或授权安装/);
});

test("keeps source and documentation ownership on demand instead of global automatic writes", () => {
  const workflow = fs.readFileSync(path.join(root, "docs", "engineering-workflow.md"), "utf8");
  assert.match(workflow, /受管源.*合同.*宿主分发.*实际加载核验/);
  assert.match(workflow, /不手改安装缓存/);
  assert.doesNotMatch(readSharedPolicy(), /自动更新受管源/);
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

  for (const policy of [codexPolicy, claudePolicy]) assert.doesNotMatch(policy, /自动更新受管源/);
  assert.match(gettingStarted, /当前授权/);
  assert.match(routing, /框架学习不提升项目事实或扩大权限/);
  for (const heading of ["## 触发条件", "## 自动推广", "## 升级确认", "## 记录格式"]) {
    assert.match(learning, new RegExp(heading));
  }
  assert.match(learning, /不记录项目特定的事实/);
});

test("keeps Harness explicit while retaining its selected project verification entrypoints", () => {
  const codexPolicy = readEffectivePolicy("codex");
  const claudePolicy = readEffectivePolicy("claude");
  const harness = readSkill("project-harness");
  const commands = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");

  for (const policy of [codexPolicy, claudePolicy]) {
    assert.match(policy, /不默认建立 Harness 账本/);
    assert.match(policy, /显式选择/);
    assert.doesNotMatch(policy, /PreToolUse|PostToolUse|自动开始 Harness/);
  }
  assert.match(frontmatter(harness).description, /explicitly select/);
  assert.match(harness, /普通工程任务不建账本/);
  assert.match(harness, /项目或任务已经选定账本且具备写入授权/);
  assert.match(harness, /harness-session\.mjs/);
  assert.match(harness, /harness-enforce\.mjs/);
  assert.match(commands, /harness-enforce.*仅属于已选中的相应流程/);
});

test("documents observed verifier execution without changing the Codex tool schema", () => {
  const harness = readSkill("project-harness");
  const commands = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");
  const harnessDoc = fs.readFileSync(path.join(root, "docs", "harness-v1.md"), "utf8");

  for (const pattern of [/harness-run\.mjs/, /verifier ID/i, /4\s*KiB/i, /8\s*KiB/i, /observation_recorded/, /observation_recalled/, /task-index\.jsonl/, /--all/, /--rebuild-index/, /runObserved\(spec\)/, /readObservation\(query\)/]) assert.match(harnessDoc, pattern);
  assert.match(harness, /docs\/harness-v1\.md/);
  assert.match(harness, /已登记的 verifier ID/);
  assert.match(commands, /verification-plan\.mjs/);
  assert.match(harnessDoc, /verification-plan\.mjs/);
  assert.match(commands, /已知只读命令直接使用原生工具/);
});

test("does not ship automatically discovered Codex or plugin hooks", () => {
  assert.equal(fs.existsSync(path.join(root, "adapters", "codex", "hooks.json")), false);
  assert.equal(fs.existsSync(path.join(root, "hooks", "hooks.json")), false);
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

  for (const policy of [codexPolicy, claudePolicy]) assert.match(policy, /项目规则/);
  for (const name of Object.keys(agents)) assert.ok(agentGuide.includes(name), name);
  assert.match(agentGuide, /宿主专用 persona 不隐式跨宿主复制/);
  assert.match(agentGuide, /文字声明不能代替安装或授权/);
  assert.match(routing, /不把 Claude 专用 agent 或 skill 隐式当成共享能力/);
  for (const phrase of ["52 个", "51 个", "230 个", "6 个核心工程入口", "3 个按需推理入口", "engineering-delivery", "project-constraints", "project-harness", "first-principles", "minimal-experiment", "ecc", "zq", "data-connector-development", "## 共享工作流", "## 共享推理 Skill", "## Claude 专用排除项"]) {
    assert.match(catalog, new RegExp(phrase));
  }
});

test("reconciles CC-Switch flags from active directories and the enabled framework plugin", () => {
  const result = buildReconciliation({
    rows: [
      {id: "local:zq", directory: "zq", enabled_claude: 1, enabled_codex: 0},
      {id: "local:data-connector-development", directory: "data-connector-development", enabled_claude: 1, enabled_codex: 1},
      {id: "local:engineering-work", directory: "engineering-work", enabled_claude: 0, enabled_codex: 1},
      {id: "local:project-onboarding", directory: "project-onboarding", enabled_claude: 0, enabled_codex: 1},
      {id: "local:document", directory: "document", enabled_claude: 0, enabled_codex: 0}
    ],
    claudeDirectories: new Set(["data-connector-development", "document"]),
    codexDirectories: new Set(["engineering-work"]),
    pluginEnabled: true
  });

  assert.deepEqual(result.counts, {claude: 4, codex: 1});
  assert.deepEqual(result.changes, [
    {id: "local:zq", before: {claude: 1, codex: 0}, after: {claude: 0, codex: 0}},
    {id: "local:data-connector-development", before: {claude: 1, codex: 1}, after: {claude: 1, codex: 0}},
    {id: "local:engineering-work", before: {claude: 0, codex: 1}, after: {claude: 1, codex: 1}},
    {id: "local:project-onboarding", before: {claude: 0, codex: 1}, after: {claude: 1, codex: 0}},
    {id: "local:document", before: {claude: 0, codex: 0}, after: {claude: 1, codex: 0}}
  ]);
});

test("keeps engineering methods in one reference without broadening workflow triggers", () => {
  const relative = "plugins/leon-engineering-core/skills/engineering-work/references/engineering-methods.md";
  const reference = fs.readFileSync(path.join(root, relative), "utf8");
  const feature = readSkill("engineering-work");
  assert.match(feature, /references\/feature-loop\.md/);
  assert.match(feature, /references\/bugfix-evidence\.md/);
  for (const mode of ["feature-loop", "bugfix-evidence"]) {
    const source = fs.readFileSync(path.join(root, path.dirname(relative), `${mode}.md`), "utf8");
    assert.match(source, /\]\(engineering-methods\.md\)/);
  }
  for (const pattern of [
    /agreed interfaces.*observable behavior/s,
    /expected results.*specification.*known-good examples.*independent/s,
    /Do not recompute.*implementation/s,
    /Mock.*test purpose/s,
    /project.*mandatory contracts.*verification routing/s,
    /prioritizing.*does not waive.*required checks/s,
    /small, clear task.*does not add.*interview.*approval/s,
    /does not trigger.*whole-repository scan.*HTML report.*parallel agents/s
  ]) assert.match(reference, pattern);
  assert.match(feature, /implement the smallest complete slice/);
  const featureSubflow = fs.readFileSync(path.join(root, "plugins/leon-engineering-core/skills/engineering-work/references/feature-loop.md"), "utf8");
  assert.match(featureSubflow, /Implement the smallest complete slice/);
});

test("preserves architecture judgment and method provenance without a new skill", () => {
  const reference = fs.readFileSync(path.join(root, "plugins/leon-engineering-core/skills/engineering-work/references/engineering-methods.md"), "utf8");
  assert.match(reference, /concentrates complexity.*forwarding.*configuration.*understanding/s);
  assert.match(reference, /thin module.*not.*deletion/s);
  assert.match(reference, /existing architecture decisions.*concrete problem.*trade-offs/s);
  assert.match(reference, /mattpocock\/skills/);
  assert.match(reference, /upstream commit.*unknown/s);
  assert.match(reference, /folder hash.*not an upstream commit/s);
  assert.match(reference, /Copyright \(c\) 2026 Matt Pocock/);
  assert.match(reference, /MIT License/);
  assert.match(reference, /permission notice shall be included/);
  assert.doesNotMatch(reference, /^---\s*\nname:/);
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

test("discovers six core entries and three opt-in reasoning entry points", () => {
  assert.deepEqual([...CORE_SKILL_NAMES].sort(), [
    "agent-routing", "engineering-delivery", "engineering-work", "project-constraints", "project-harness", "project-onboarding"
  ]);
  assert.deepEqual([...EXTENDED_SKILL_NAMES].sort(), [
    "evidence-and-experiments", "logging-observability", "problem-framing", "skill-health", "solution-comparison"
  ]);
  const delivery = readSkill("engineering-delivery");
  assert.match(delivery, /current-task authorization/i);
  assert.doesNotMatch(delivery, /direct push is the default|standing delivery preference/i);
});
