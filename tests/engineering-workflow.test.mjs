import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {install, CORE_SKILL_NAMES} from "../scripts/install-codex-adapter.mjs";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, "plugins", "leon-engineering-core", "skills");
const branches = [
  {legacy: "feature-loop", reference: "feature-development.md", evidence: /Implement the smallest complete slice/},
  {legacy: "bugfix-evidence", reference: "defect-repair.md", evidence: /Reproduce the reported failure before editing/},
  {legacy: "review-ship", reference: "review.md", evidence: /Inventory the diff/}
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
    const target = path.join(skillsRoot, "agent-routing", "references", branch.reference);
    assert.ok(linkedFiles(primary, path.join(skillsRoot, "agent-routing")).includes(target));
    assert.ok(fs.existsSync(target));
    assert.doesNotMatch(fs.readFileSync(target, "utf8"), /^---\nname:/);
  }
  assert.match(primary, /only the matching subflow/i);
});

test("legacy workflow identities forward to the same primary and canonical subflows", () => {
  assert.deepEqual([...CORE_SKILL_NAMES].sort(), ["agent-routing", "bugfix-evidence", "feature-loop", "iteration-delivery", "project-adapter", "project-bootstrap", "project-constraints", "project-harness", "review-ship"].sort());
  for (const branch of branches) {
    const directory = path.join(skillsRoot, branch.legacy);
    const source = read(`${branch.legacy}/SKILL.md`);
    assert.match(source, new RegExp(`^name: ${branch.legacy}$`, "m"));
    assert.match(source, /description: Use when explicitly invoking/);
    const linked = linkedFiles(source, directory);
    assert.ok(linked.includes(path.join(skillsRoot, "agent-routing", "SKILL.md")));
    assert.ok(linked.includes(path.join(skillsRoot, "agent-routing", "references", branch.reference)));
    assert.doesNotMatch(source, branch.evidence);
    assert.match(read(`agent-routing/references/${branch.reference}`), branch.evidence);
  }
});

test("unified routing preserves risk, authorization, project policy and evidence boundaries", () => {
  const primary = read("agent-routing/SKILL.md");
  for (const tier of ["read-only", "local-only", "isolated", "full-delivery"]) assert.ok(primary.includes(`\`${tier}\``));
  for (const boundary of ["verification-policy.json", "no-push", "NOT_RUN", "Harness"]) assert.ok(primary.includes(boundary), boundary);
  const delivery = read("iteration-delivery/SKILL.md");
  for (const flag of ["--delivery-required", "--require-delivery"]) assert.ok(delivery.includes(flag), flag);
  assert.match(primary, /schema.*dependencies.*CI.*database.*security.*desktop.*cross-platform/);
  assert.match(primary, /mandatory.*checks|必需.*验收/i);
  assert.match(read("agent-routing/references/review.md"), /read-only by default/);
  assert.match(read("agent-routing/references/defect-repair.md"), /hypothesis.*missing evidence/i);
  assert.match(read("agent-routing/references/feature-development.md"), /acceptance criteria/);
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
  const delivery = read("iteration-delivery/SKILL.md");
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
    const legacyDirectory = path.join(target, branch.legacy);
    const legacy = fs.readFileSync(path.join(legacyDirectory, "SKILL.md"), "utf8");
    const canonical = path.join(target, "agent-routing", "references", branch.reference);
    assert.ok(linkedFiles(legacy, legacyDirectory).includes(canonical));
    const source = fs.readFileSync(canonical, "utf8");
    for (const file of linkedFiles(source, path.dirname(canonical))) assert.ok(fs.existsSync(file), file);
    assert.match(source, branch.evidence);
  }
});
