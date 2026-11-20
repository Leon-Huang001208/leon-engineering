import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {install, CORE_SKILL_NAMES} from "../scripts/install-codex-adapter.mjs";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, "plugins", "leon-engineering-core", "skills");
const branches = [
  {legacy: "feature-loop", entry: "engineering-work", reference: "feature-loop.md", alias: "feature-development.md", evidence: /Implement the smallest complete slice/},
  {legacy: "bugfix-evidence", entry: "engineering-work", reference: "bugfix-evidence.md", alias: "defect-repair.md", evidence: /Reproduce the reported failure before editing/},
  {legacy: "review-ship", entry: "engineering-delivery", reference: "review-ship.md", alias: "review.md", evidence: /Inventory the diff/}
];

function read(relative) {
  return fs.readFileSync(path.join(skillsRoot, relative), "utf8");
}

function linkedFiles(source, directory) {
  return [...source.matchAll(/\]\(([^)]+\.md)\)/g)].map(match => path.resolve(directory, match[1]));
}

test("primary entry has a bounded read budget and explicit fast-path exclusions", () => {
  const primary = read("agent-routing/SKILL.md");
  assert.ok(Buffer.byteLength(primary, "utf8") <= 2300, "default primary exceeds the measured document budget");
  assert.match(primary, /general chat/);
  assert.match(primary, /single known read\/command/);
  assert.match(primary, /project rules|Project rules/);
  assert.match(primary, /only the matching subflow/i);
});

test("agent-routing is the primary engineering entry with three on-demand subflows", () => {
  const primary = read("agent-routing/SKILL.md");
  assert.match(primary, /description: Use when .*engineering task/);
  assert.match(primary, /primary entry/i);
  for (const branch of branches) {
    const target = path.join(skillsRoot, branch.entry, "references", branch.reference);
    assert.ok(linkedFiles(primary, path.join(skillsRoot, "agent-routing")).includes(target));
    assert.ok(fs.existsSync(target));
    assert.doesNotMatch(fs.readFileSync(target, "utf8"), /^---\nname:/);
  }
  assert.match(primary, /only the matching subflow/i);
});

test("consolidated entries retain canonical subflows and prior reference aliases", () => {
  assert.deepEqual([...CORE_SKILL_NAMES].sort(), ["agent-routing", "engineering-work", "engineering-delivery", "project-onboarding", "project-constraints", "project-harness"].sort());
  for (const branch of branches) {
    assert.equal(fs.existsSync(path.join(skillsRoot, branch.legacy, "SKILL.md")), false);
    const source = read(`agent-routing/references/${branch.alias}`);
    const linked = linkedFiles(source, path.join(skillsRoot, "agent-routing", "references"));
    assert.ok(linked.includes(path.join(skillsRoot, branch.entry, "references", branch.reference)));
    assert.doesNotMatch(source, branch.evidence);
    assert.match(read(`${branch.entry}/references/${branch.reference}`), branch.evidence);
  }
});

test("unified routing preserves risk, authorization, project policy and evidence boundaries", () => {
  const primary = read("agent-routing/SKILL.md");
  for (const tier of ["read-only", "local-only", "isolated", "full-delivery"]) assert.ok(primary.includes(`\`${tier}\``));
  for (const boundary of ["verification-policy.json", "no-push", "NOT_RUN", "Harness"]) assert.ok(primary.includes(boundary), boundary);
  const delivery = read("engineering-delivery/references/iteration-delivery.md");
  for (const flag of ["--delivery-required", "--require-delivery"]) assert.ok(delivery.includes(flag), flag);
  assert.match(primary, /schema.*dependencies.*CI.*database.*security.*desktop.*cross-platform/);
  assert.match(primary, /mandatory.*checks|必需.*验收/i);
  assert.match(read("engineering-delivery/references/review-ship.md"), /read-only by default/);
  assert.match(read("engineering-work/references/bugfix-evidence.md"), /hypothesis.*missing evidence/i);
  assert.match(read("engineering-work/references/feature-loop.md"), /acceptance criteria/);
});

test("global policy is a small dispatcher without automatic Harness or Hook instructions", () => {
  const policy = ["shared", "codex"].map(host => fs.readFileSync(path.join(root, "adapters", host, "global-policy.md"), "utf8").trim()).join("\n\n");
  assert.ok(Buffer.byteLength(policy, "utf8") <= 700, "global policy must leave detailed workflows on demand");
  assert.match(policy, /项目规则/);
  assert.match(policy, /agent-routing/);
  assert.doesNotMatch(policy, /PreToolUse|PostToolUse|socratic-clarification|--delivery-required|自动开始.*Harness/);
});

test("routine engineering and manual tools require explicit Harness selection", () => {
  const primary = read("agent-routing/SKILL.md");
  assert.match(primary, /Harness is opt-in/);
  assert.doesNotMatch(primary, /Focused checks, Harness record/);
  const harness = read("project-harness/SKILL.md");
  assert.match(harness, /显式选择/);
  assert.doesNotMatch(harness, /必须自动开始|工具边界自动建立|PreToolUse|PostToolUse/);
  const delivery = read("engineering-delivery/references/iteration-delivery.md");
  assert.match(delivery, /current task authorization/);
  assert.doesNotMatch(delivery, /standing delivery preference|A direct push is the default|record the Harness result/);
});

test("global installation guide describes policy and docs separately from optional runtime", () => {
  const guide = fs.readFileSync(path.join(root, "adapters", "codex", "global-docs", "COMMANDS_GUIDE.md"), "utf8");
  assert.match(guide, /--install-global/);
  assert.match(guide, /不安装.*Hook/);
  assert.match(guide, /运行时.*按需/);
  assert.match(guide, /harness-runtime\.mjs --install/);
  assert.doesNotMatch(guide, /安装器可重建规范 Hook|Agent 自动开始新任务|窄小改运行普通交付硬门/);
});

test("references remain usable in a flat adapter installation without parallel workflow bodies", context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "leon-primary-workflow-"));
  context.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const target = path.join(directory, "skills");
  install({sourceRoot: root, targetRoot: target});
  for (const branch of branches) {
    const aliasDirectory = path.join(target, "agent-routing", "references");
    const alias = fs.readFileSync(path.join(aliasDirectory, branch.alias), "utf8");
    const canonical = path.join(target, branch.entry, "references", branch.reference);
    assert.ok(linkedFiles(alias, aliasDirectory).includes(canonical));
    const source = fs.readFileSync(canonical, "utf8");
    for (const file of linkedFiles(source, path.dirname(canonical))) assert.ok(fs.existsSync(file), file);
    assert.match(source, branch.evidence);
  }
});
