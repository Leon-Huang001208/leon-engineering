import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {auditSkillTree, previewSkillPortfolio} from "../scripts/skill-portfolio.mjs";

const cli = fileURLToPath(new URL("../scripts/skill-discovery-plan.mjs", import.meta.url));
const plugins = ["leon-engineering-core", "leon-engineering-workflows"];

function writeSkill(directory, name) {
  fs.mkdirSync(path.join(directory, "references"), {recursive: true});
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture skill.\n---\n`);
  fs.writeFileSync(path.join(directory, "references", "guide.md"), "Fixture reference.\n");
  fs.writeFileSync(path.join(directory, ".hidden"), "Whole-tree comparison includes hidden files.\n");
}

function fixture(testContext) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "leon-discovery-"));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const sourceRoot = path.join(root, "repo");
  for (const plugin of plugins) fs.mkdirSync(path.join(sourceRoot, "plugins", plugin, "skills"), {recursive: true});
  const skillsRoot = path.join(root, "global", "skills");
  fs.mkdirSync(skillsRoot, {recursive: true});
  const canonical = path.join(sourceRoot, "plugins", plugins[0], "skills", "agent-routing");
  const source = path.join(skillsRoot, "agent-routing");
  writeSkill(canonical, "agent-routing");
  fs.cpSync(canonical, source, {recursive: true});
  const backupRoot = path.join(root, "backups");
  const receiptPath = path.join(root, "receipts", "batch.json");
  const args = ["--source-root", sourceRoot, "--skills-root", skillsRoot, "--backup-root", backupRoot, "--receipt", receiptPath];
  return {root, sourceRoot, skillsRoot, canonical, source, backupRoot, receiptPath, args};
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {encoding: "utf8", timeout: 10_000});
  assert.ifError(result.error);
  return result;
}

function plan(args) {
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function failsClosed(args, code) {
  const result = run(args);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.length < 256);
  assert.deepEqual(JSON.parse(result.stderr), {schemaVersion: 1, error: {code}});
  assert.doesNotMatch(result.stderr, /PRIVATE_CANARY|\bstack\b|node:fs/);
}

function withValue(args, flag, value) {
  const changed = [...args];
  changed[changed.indexOf(flag) + 1] = value;
  return changed;
}

function snapshot(root) {
  const entries = [];
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      const entry = {path: path.relative(root, absolute), mode: stat.mode, mtime: stat.mtimeMs};
      if (stat.isSymbolicLink()) entry.target = fs.readlinkSync(absolute);
      else if (stat.isFile()) entry.hash = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      entries.push(entry);
      if (stat.isDirectory()) visit(absolute);
    }
  }
  visit(root);
  return entries;
}

test("help describes read-only planning without requiring project roots", () => {
  for (const flag of ["--help", "-h"]) {
    const result = run([flag]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: skill-discovery-plan\.mjs/);
    assert.match(result.stdout, /Read-only/);
    assert.equal(result.stderr, "");
  }
});

test("default CLI prints a whole-tree exact-duplicate manifest without writing", testContext => {
  const fixtureData = fixture(testContext);
  const before = snapshot(fixtureData.root);
  const result = plan(fixtureData.args);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.backupRoot, fixtureData.backupRoot);
  assert.equal(result.receiptPath, fixtureData.receiptPath);
  assert.equal(result.actions.length, 1);
  assert.deepEqual(result.actions[0], {
    id: result.actions[0].id,
    kind: "exact-duplicate",
    source: fixtureData.source,
    canonical: fixtureData.canonical,
    expectedTreeHash: auditSkillTree(fixtureData.source).treeHash
  });
  assert.match(result.actions[0].id, /^[a-z0-9][a-z0-9-]{0,79}$/);
  assert.equal(result.summary.actionCount, 1);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(snapshot(fixtureData.root), before);
  assert.equal(fs.existsSync(fixtureData.backupRoot), false);
  assert.equal(fs.existsSync(fixtureData.receiptPath), false);

  // The test, not the planner, persists stdout for the existing independent consumer.
  const manifestPath = path.join(fixtureData.root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(result));
  assert.equal(previewSkillPortfolio({manifestPath}).valid, true);
});

test("divergent trees are skipped unless explicitly hash-pinned for quarantine", testContext => {
  const fixtureData = fixture(testContext);
  const divergent = [];
  for (const [plugin, name, changedFile] of [
    [plugins[1], "fact-checking", "references/guide.md"],
    [plugins[0], "engineering-work", ".hidden"]
  ]) {
    const canonical = path.join(fixtureData.sourceRoot, "plugins", plugin, "skills", name);
    const source = path.join(fixtureData.skillsRoot, name);
    writeSkill(canonical, name);
    fs.cpSync(canonical, source, {recursive: true});
    fs.appendFileSync(path.join(source, changedFile), "PRIVATE_CONTENT_CANARY\n");
    divergent.push(source);
  }
  const before = snapshot(fixtureData.root);
  const ordinary = plan(fixtureData.args);
  assert.equal(ordinary.actions.length, 1);
  assert.deepEqual(ordinary.skipped.map(item => item.reason), ["divergent", "divergent"]);
  assert.equal(ordinary.summary.quarantineCount, 0);

  const included = plan([...fixtureData.args, "--include-divergent"]);
  assert.equal(included.actions.length, 3);
  assert.equal(included.summary.exactDuplicateCount, 1);
  assert.equal(included.summary.quarantineCount, 2);
  assert.deepEqual(included.skipped, []);
  for (const source of divergent) {
    const action = included.actions.find(item => item.source === source);
    assert.deepEqual(action, {
      id: action.id,
      kind: "quarantine",
      source,
      expectedTreeHash: auditSkillTree(source).treeHash
    });
    assert.equal(Object.hasOwn(action, "canonical"), false);
  }
  assert.equal(included.actions.find(item => item.source === fixtureData.source).id, ordinary.actions[0].id);
  assert.doesNotMatch(JSON.stringify(included), /PRIVATE_CONTENT_CANARY/);
  assert.deepEqual(snapshot(fixtureData.root), before);

  const manifestPath = path.join(fixtureData.root, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(included));
  assert.equal(previewSkillPortfolio({manifestPath}).valid, true);
});

test("linked Skill roots are ownership_unknown, including cc-switch and dangling links", testContext => {
  const fixtureData = fixture(testContext);
  const target = path.join(fixtureData.root, "cc-switch", "agent-routing");
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.renameSync(fixtureData.source, target);
  fs.symlinkSync(target, fixtureData.source);
  const canonical = path.join(fixtureData.sourceRoot, "plugins", plugins[1], "skills", "problem-framing");
  writeSkill(canonical, "problem-framing");
  fs.symlinkSync(path.join(fixtureData.root, "absent-target"), path.join(fixtureData.skillsRoot, "problem-framing"));
  const before = snapshot(fixtureData.root);

  for (const flags of [[], ["--include-divergent"]]) {
    const result = plan([...fixtureData.args, ...flags]);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.skipped.map(item => item.reason), ["ownership_unknown", "ownership_unknown"]);
  }
  assert.deepEqual(snapshot(fixtureData.root), before);
  assert.equal(auditSkillTree(target).treeHash, auditSkillTree(fixtureData.canonical).treeHash);
});

test("only flat canonical SKILL.md names from the active plugins are inspected", testContext => {
  const fixtureData = fixture(testContext);
  for (const name of ["source-command-hello", "source-command-jira", "private-local-skill"]) {
    const canonical = path.join(fixtureData.sourceRoot, "plugins", "other-plugin", "skills", name);
    writeSkill(canonical, name);
    writeSkill(path.join(fixtureData.skillsRoot, name), name);
  }
  const nonSkill = path.join(fixtureData.sourceRoot, "plugins", plugins[1], "skills", "not-a-skill");
  fs.mkdirSync(nonSkill, {recursive: true});
  fs.writeFileSync(path.join(nonSkill, "skill.md"), "PRIVATE_CANARY\n");
  writeSkill(path.join(fixtureData.skillsRoot, "not-a-skill"), "not-a-skill");
  writeSkill(path.join(fixtureData.skillsRoot, "nested", "agent-routing"), "agent-routing");
  const before = snapshot(fixtureData.root);

  const result = plan([...fixtureData.args, "--include-divergent"]);
  assert.equal(result.summary.canonicalSkillCount, 1);
  assert.deepEqual(result.actions.map(action => action.source), [fixtureData.source]);
  assert.deepEqual(result.skipped, []);
  assert.doesNotMatch(JSON.stringify(result), /source-command-hello|source-command-jira|private-local-skill|not-a-skill|PRIVATE_CANARY/);
  assert.deepEqual(snapshot(fixtureData.root), before);
});

test("retired commands are not canonical and similarly named user Skills receive no automatic action", testContext => {
  const fixtureData = fixture(testContext);
  const retiredRoot = path.join(fixtureData.sourceRoot, "plugins", "leon-engineering-commands");
  for (const name of ["source-command-aside", "source-command-build-fix", "agent-routing"]) {
    writeSkill(path.join(retiredRoot, "skills", name), name);
    if (name !== "agent-routing") writeSkill(path.join(fixtureData.skillsRoot, name), name);
  }
  fs.appendFileSync(path.join(fixtureData.skillsRoot, "source-command-build-fix", "SKILL.md"), "User-owned divergence.\n");
  const before = snapshot(fixtureData.root);
  for (const flags of [[], ["--include-divergent"]]) {
    const result = plan([...fixtureData.args, ...flags]);
    assert.equal(result.summary.canonicalSkillCount, 1);
    assert.deepEqual(result.actions.map(action => action.source), [fixtureData.source]);
    assert.deepEqual(result.skipped, []);
    assert.doesNotMatch(JSON.stringify(result), /source-command-|leon-engineering-commands/);
  }
  assert.deepEqual(snapshot(fixtureData.root), before);
});

test("missing and unsupported source or canonical trees cannot become quarantine actions", testContext => {
  const fixtureData = fixture(testContext);
  const cases = ["missing", "plain-file", "no-skill", "internal-link", "unreadable", "bad-canonical"];
  for (const name of cases) {
    const canonical = path.join(fixtureData.sourceRoot, "plugins", plugins[1], "skills", name);
    const source = path.join(fixtureData.skillsRoot, name);
    writeSkill(canonical, name);
    if (name === "missing") continue;
    if (name === "plain-file") {
      fs.writeFileSync(source, "PRIVATE_CANARY\n");
      continue;
    }
    fs.cpSync(canonical, source, {recursive: true});
    if (name === "no-skill") fs.rmSync(path.join(source, "SKILL.md"));
    if (name === "internal-link") fs.symlinkSync(fixtureData.canonical, path.join(source, "linked"));
    if (name === "unreadable") {
      fs.chmodSync(path.join(source, "SKILL.md"), 0);
      testContext.after(() => {
        if (fs.existsSync(path.join(source, "SKILL.md"))) fs.chmodSync(path.join(source, "SKILL.md"), 0o600);
      });
    }
    if (name === "bad-canonical") fs.symlinkSync(source, path.join(canonical, "linked"));
  }
  const result = plan([...fixtureData.args, "--include-divergent"]);
  assert.deepEqual(result.actions.map(action => action.source), [fixtureData.source]);
  assert.equal(result.skipped.length, cases.length);
  assert.equal(result.skipped.find(item => item.name === "missing").reason, "missing");
  assert.ok(result.skipped.filter(item => item.name !== "missing").every(item => item.reason === "unsupported_tree"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY/);
});

test("action IDs stay unique and deterministic across reordered explicit roots and long names", testContext => {
  const fixtureData = fixture(testContext);
  const secondRoot = path.join(fixtureData.root, "second-global", "skills");
  fs.cpSync(fixtureData.skillsRoot, secondRoot, {recursive: true});
  for (const suffix of ["first", "second"]) {
    const name = `same-long-prefix-${"x".repeat(100)}-${suffix}`;
    const canonical = path.join(fixtureData.sourceRoot, "plugins", plugins[1], "skills", name);
    writeSkill(canonical, name);
    for (const root of [fixtureData.skillsRoot, secondRoot]) fs.cpSync(canonical, path.join(root, name), {recursive: true});
  }
  const forward = run([...fixtureData.args, "--skills-root", secondRoot]);
  const reversed = run([
    ...fixtureData.args.slice(0, 2), "--skills-root", secondRoot, ...fixtureData.args.slice(4),
    "--skills-root", fixtureData.skillsRoot, "--skills-root", `${fixtureData.skillsRoot}/.`
  ]);
  assert.equal(forward.status, 0, forward.stderr);
  assert.equal(reversed.status, 0, reversed.stderr);
  assert.equal(forward.stdout, reversed.stdout);
  assert.equal(forward.stdout, run([...fixtureData.args, "--skills-root", secondRoot]).stdout);
  const result = JSON.parse(forward.stdout);
  assert.equal(result.actions.length, 6);
  assert.equal(new Set(result.actions.map(action => action.id)).size, 6);
  assert.ok(result.actions.every(action => /^[a-z0-9][a-z0-9-]{0,79}$/.test(action.id)));
});

test("all inputs are explicit and invalid or output arguments fail without writes or disclosure", testContext => {
  const fixtureData = fixture(testContext);
  const output = path.join(fixtureData.root, "PRIVATE_CANARY-output.json");
  fs.writeFileSync(output, "PRIVATE_CANARY\n");
  const before = snapshot(fixtureData.root);
  failsClosed([], "invalid_args");
  for (const [flag, code] of [
    ["--source-root", "invalid_source_root"],
    ["--skills-root", "invalid_skills_root"],
    ["--backup-root", "invalid_backup_root"],
    ["--receipt", "invalid_receipt_path"]
  ]) {
    failsClosed(withValue(fixtureData.args, flag, "relative/PRIVATE_CANARY"), code);
    const index = fixtureData.args.indexOf(flag);
    failsClosed([...fixtureData.args.slice(0, index), ...fixtureData.args.slice(index + 2)], "invalid_args");
    if (flag !== "--skills-root") failsClosed([...fixtureData.args, flag, fixtureData.args[index + 1]], "invalid_args");
  }
  for (const extra of [
    ["--output", output], ["--out", output], ["--output=PRIVATE_CANARY"], ["--apply"],
    ["--include-divergent=true"], ["--include-divergent", "--include-divergent"], ["PRIVATE_CANARY"]
  ]) failsClosed([...fixtureData.args, ...extra], "invalid_args");
  failsClosed(fixtureData.args.slice(0, -1), "invalid_args");
  assert.deepEqual(snapshot(fixtureData.root), before);
});

test("invalid root types, aliases, overlapping roots and occupied destinations fail closed", testContext => {
  const fixtureData = fixture(testContext);
  const plainFile = path.join(fixtureData.root, "PRIVATE_CANARY-file");
  fs.writeFileSync(plainFile, "PRIVATE_CANARY\n");
  const link = path.join(fixtureData.root, "linked-global");
  fs.symlinkSync(path.dirname(fixtureData.skillsRoot), link);
  const repoLink = path.join(fixtureData.root, "linked-repo");
  fs.symlinkSync(fixtureData.sourceRoot, repoLink);
  const backupLink = path.join(fixtureData.root, "linked-backup");
  fs.symlinkSync(path.join(fixtureData.root, "absent"), backupLink);
  const before = snapshot(fixtureData.root);
  const cases = [
    ["--source-root", path.join(fixtureData.root, "missing"), "invalid_source_root"],
    ["--source-root", plainFile, "invalid_source_root"],
    ["--source-root", repoLink, "invalid_source_root"],
    ["--skills-root", path.join(fixtureData.root, "missing"), "invalid_skills_root"],
    ["--skills-root", plainFile, "invalid_skills_root"],
    ["--skills-root", link, "invalid_skills_root"],
    ["--skills-root", path.join(link, "skills"), "invalid_skills_root"],
    ["--skills-root", fixtureData.sourceRoot, "invalid_skills_root"],
    ["--skills-root", fixtureData.canonical, "invalid_skills_root"],
    ["--backup-root", plainFile, "invalid_backup_root"],
    ["--backup-root", backupLink, "invalid_backup_root"],
    ["--backup-root", path.join(plainFile, "nested"), "invalid_backup_root"],
    ["--backup-root", path.join(link, "backups"), "invalid_backup_root"],
    ["--backup-root", path.join(fixtureData.skillsRoot, "backup"), "invalid_backup_root"],
    ["--backup-root", path.join(fixtureData.sourceRoot, "backup"), "invalid_backup_root"],
    ["--receipt", plainFile, "invalid_receipt_path"],
    ["--receipt", fixtureData.root, "invalid_receipt_path"],
    ["--receipt", backupLink, "invalid_receipt_path"],
    ["--receipt", path.join(plainFile, "receipt.json"), "invalid_receipt_path"],
    ["--receipt", path.join(link, "receipt.json"), "invalid_receipt_path"],
    ["--receipt", path.join(fixtureData.skillsRoot, "receipt.json"), "invalid_receipt_path"],
    ["--receipt", path.join(fixtureData.sourceRoot, "receipt.json"), "invalid_receipt_path"],
    ["--receipt", fixtureData.backupRoot, "invalid_receipt_path"]
  ];
  for (const [flag, value, code] of cases) failsClosed(withValue(fixtureData.args, flag, value), code);
  assert.deepEqual(snapshot(fixtureData.root), before);
});

test("canonical plugin aliases, missing plugin roots and ambiguous names invalidate the source root", testContext => {
  const fixtureData = fixture(testContext);
  const workflowsRoot = path.join(fixtureData.sourceRoot, "plugins", plugins[1], "skills");
  const moved = path.join(fixtureData.root, "workflows");
  fs.renameSync(workflowsRoot, moved);
  failsClosed(fixtureData.args, "invalid_source_root");
  fs.symlinkSync(moved, workflowsRoot);
  failsClosed(fixtureData.args, "invalid_source_root");
  fs.unlinkSync(workflowsRoot);
  fs.renameSync(moved, workflowsRoot);

  const pluginsRoot = path.join(fixtureData.sourceRoot, "plugins");
  const movedPlugins = path.join(fixtureData.root, "plugin-alias");
  fs.renameSync(pluginsRoot, movedPlugins);
  fs.symlinkSync(movedPlugins, pluginsRoot);
  failsClosed(fixtureData.args, "invalid_source_root");
  fs.unlinkSync(pluginsRoot);
  fs.renameSync(movedPlugins, pluginsRoot);

  writeSkill(path.join(workflowsRoot, "agent-routing"), "agent-routing");
  failsClosed(fixtureData.args, "invalid_source_root");
});

test("backup action collisions cannot produce a directly executable manifest", testContext => {
  const fixtureData = fixture(testContext);
  const action = plan(fixtureData.args).actions[0];
  fs.mkdirSync(fixtureData.backupRoot);
  fs.symlinkSync(path.join(fixtureData.root, "absent"), path.join(fixtureData.backupRoot, action.id));
  const before = snapshot(fixtureData.root);
  failsClosed(fixtureData.args, "invalid_backup_root");
  assert.deepEqual(snapshot(fixtureData.root), before);
});
