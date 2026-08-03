import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import {SKILL_NAMES} from "../scripts/install-codex-adapter.mjs";

const root = path.resolve(import.meta.dirname, "..");

const skills = {
  "project-bootstrap": ["project instructions", "CI"],
  "feature-loop": ["acceptance criteria", "worktree"],
  "bugfix-evidence": ["reproduce", "root cause"],
  "review-ship": ["diff", "handoff"],
  "logging-observability": ["structured", "redact"],
  "agent-routing": ["worktree", "agent team"],
  "skill-health": ["overlap", "Never delete"],
  "project-adapter": ["read-only", "candidate"]
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

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "expected YAML frontmatter");
  return YAML.parse(match[1]);
}

test("ships the seven focused workflow skills", () => {
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
});

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

test("documents fast path, investigation, and worktree pilots", () => {
  const source = fs.readFileSync(path.join(root, "docs", "high-throughput-pilot.md"), "utf8");
  for (const heading of ["## 快路径", "## 只读调研", "## 隔离实现"]) {
    assert.match(source, new RegExp(heading));
  }
  assert.match(source, /不以耗时宣称代替实际证据/);
});
