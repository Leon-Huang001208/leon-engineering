import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  auditSkillTree,
  copySanitizedSkill,
  previewSkillPortfolio,
  applySkillPortfolio,
  rollbackSkillPortfolio
} from "../scripts/skill-portfolio.mjs";

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-skill-portfolio-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

function writeSkill(directory, name, extra = "") {
  fs.mkdirSync(path.join(directory, "references"), {recursive: true});
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n${extra}\n`);
  fs.writeFileSync(path.join(directory, "references", "guide.md"), `# ${name}\n`);
}

function writeManifest(root, actions) {
  const file = path.join(root, "actions.json");
  const backupRoot = path.join(root, "backup");
  const receiptPath = path.join(root, "receipt.json");
  fs.writeFileSync(file, `${JSON.stringify({schemaVersion: 1, backupRoot, receiptPath, actions}, null, 2)}\n`);
  return {file, backupRoot, receiptPath};
}

test("previews, applies, and rolls back an exact Skill retirement", t => {
  const root = makeRoot(t);
  const source = path.join(root, "skills", "duplicate");
  const canonical = path.join(root, "plugin", "duplicate");
  writeSkill(source, "duplicate");
  writeSkill(canonical, "duplicate");
  const audit = auditSkillTree(source);
  const {file, backupRoot, receiptPath} = writeManifest(root, [{
    id: "duplicate",
    source,
    canonical,
    expectedTreeHash: audit.treeHash
  }]);

  const preview = previewSkillPortfolio({manifestPath: file});
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.summary, {actionCount: 1, fileCount: 2, bytes: audit.bytes});
  assert.equal(fs.existsSync(backupRoot), false);

  const applied = applySkillPortfolio({manifestPath: file});
  assert.equal(applied.status, "applied");
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(path.join(backupRoot, "duplicate", "SKILL.md")), true);
  assert.equal(fs.statSync(backupRoot).mode & 0o777, 0o700);
  assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
  assert.equal(auditSkillTree(path.join(backupRoot, "duplicate")).treeHash, audit.treeHash);

  const rolledBack = rollbackSkillPortfolio({receiptPath});
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(path.join(backupRoot, "duplicate")), false);
});

test("fails the full batch before moving a stale source", t => {
  const root = makeRoot(t);
  const actions = [];
  for (const name of ["first", "second"]) {
    const source = path.join(root, "skills", name);
    const canonical = path.join(root, "plugin", name);
    writeSkill(source, name);
    writeSkill(canonical, name);
    actions.push({id: name, source, canonical, expectedTreeHash: auditSkillTree(source).treeHash});
  }
  fs.appendFileSync(path.join(actions[1].source, "SKILL.md"), "changed\n");
  const {file, backupRoot} = writeManifest(root, actions);

  const preview = previewSkillPortfolio({manifestPath: file});
  assert.equal(preview.valid, false);
  assert.match(preview.conflicts.join("\n"), /second:source-hash/);
  assert.throws(() => applySkillPortfolio({manifestPath: file}), /portfolio preflight failed/);
  assert.equal(fs.existsSync(actions[0].source), true);
  assert.equal(fs.existsSync(actions[1].source), true);
  assert.equal(fs.existsSync(backupRoot), false);
});

test("accepts a canonical root symlink while keeping the source tree regular", t => {
  const root = makeRoot(t);
  const source = path.join(root, "skills", "linked-canonical");
  const canonicalTarget = path.join(root, "cc-switch", "linked-canonical");
  const canonical = path.join(root, "codex", "linked-canonical");
  writeSkill(source, "linked-canonical");
  writeSkill(canonicalTarget, "linked-canonical");
  fs.mkdirSync(path.dirname(canonical), {recursive: true});
  fs.symlinkSync(canonicalTarget, canonical);
  const {file} = writeManifest(root, [{
    id: "linked-canonical",
    source,
    canonical,
    expectedTreeHash: auditSkillTree(source).treeHash
  }]);

  assert.equal(previewSkillPortfolio({manifestPath: file}).valid, true);
});

test("rejects unsafe entries and backup collisions", async t => {
  await t.test("symbolic link", () => {
    const root = makeRoot(t);
    const source = path.join(root, "skills", "linked");
    const canonical = path.join(root, "plugin", "linked");
    writeSkill(source, "linked");
    writeSkill(canonical, "linked");
    fs.symlinkSync(path.join(source, "SKILL.md"), path.join(source, "linked.md"));
    assert.throws(() => auditSkillTree(source), /symbolic link/);
  });

  await t.test("unreadable file", () => {
    const root = makeRoot(t);
    const source = path.join(root, "skills", "unreadable");
    writeSkill(source, "unreadable");
    const target = path.join(source, "SKILL.md");
    fs.chmodSync(target, 0o000);
    t.after(() => {
      if (fs.existsSync(target)) fs.chmodSync(target, 0o600);
    });
    assert.throws(() => auditSkillTree(source), /unreadable/);
  });

  await t.test("backup collision", () => {
    const root = makeRoot(t);
    const source = path.join(root, "skills", "collision");
    const canonical = path.join(root, "plugin", "collision");
    writeSkill(source, "collision");
    writeSkill(canonical, "collision");
    const {file, backupRoot} = writeManifest(root, [{
      id: "collision", source, canonical, expectedTreeHash: auditSkillTree(source).treeHash
    }]);
    fs.mkdirSync(path.join(backupRoot, "collision"), {recursive: true});
    assert.equal(previewSkillPortfolio({manifestPath: file}).valid, false);
    assert.throws(() => applySkillPortfolio({manifestPath: file}), /portfolio preflight failed/);
  });
});

test("rollback refuses a recreated source or drifted backup", t => {
  const root = makeRoot(t);
  const source = path.join(root, "skills", "duplicate");
  const canonical = path.join(root, "plugin", "duplicate");
  writeSkill(source, "duplicate");
  writeSkill(canonical, "duplicate");
  const {file, backupRoot, receiptPath} = writeManifest(root, [{
    id: "duplicate", source, canonical, expectedTreeHash: auditSkillTree(source).treeHash
  }]);
  applySkillPortfolio({manifestPath: file});

  fs.mkdirSync(source, {recursive: true});
  assert.throws(() => rollbackSkillPortfolio({receiptPath}), /rollback preflight failed/);
  fs.rmdirSync(source);
  fs.appendFileSync(path.join(backupRoot, "duplicate", "SKILL.md"), "drift\n");
  assert.throws(() => rollbackSkillPortfolio({receiptPath}), /rollback preflight failed/);
});

test("copies a sanitized project Skill without credentials or runtime state", t => {
  const root = makeRoot(t);
  const source = path.join(root, "global", "project-skill");
  const destination = path.join(root, "project", "project-skill");
  writeSkill(source, "project-skill");
  fs.mkdirSync(path.join(source, "scripts", "__pycache__"), {recursive: true});
  fs.mkdirSync(path.join(source, "logs"), {recursive: true});
  fs.mkdirSync(path.join(source, "output"), {recursive: true});
  fs.mkdirSync(path.join(source, "data"), {recursive: true});
  fs.writeFileSync(path.join(source, "scripts", "run.py"), "print('ok')\n");
  fs.writeFileSync(path.join(source, "scripts", "__pycache__", "run.pyc"), "compiled");
  fs.writeFileSync(path.join(source, "logs", "run.log"), "state");
  fs.writeFileSync(path.join(source, "output", "result.json"), "{}");
  fs.writeFileSync(path.join(source, "data", "sample.xlsx"), "binary");
  fs.writeFileSync(path.join(source, ".env"), "SECRET_VALUE=PRIVATE_ENV_CANARY");
  fs.writeFileSync(path.join(source, "config.yaml"), "token: PRIVATE_CONFIG_CANARY\n");
  fs.writeFileSync(path.join(source, "runtime.lock"), "locked");

  const result = copySanitizedSkill({source, destination});

  assert.deepEqual(result.included, ["SKILL.md", "references/guide.md", "scripts/run.py"]);
  assert.equal(result.excluded.length, 7);
  assert.equal(fs.existsSync(path.join(destination, "scripts", "run.py")), true);
  assert.equal(fs.existsSync(path.join(destination, ".env")), false);
  assert.equal(fs.existsSync(path.join(destination, "config.yaml")), false);
  const rendered = JSON.stringify(result) + fs.readFileSync(path.join(destination, "SKILL.md"), "utf8");
  assert.doesNotMatch(rendered, /PRIVATE_ENV_CANARY|PRIVATE_CONFIG_CANARY/);
});

test("sanitized copy refuses a literal secret in an included source file", t => {
  const root = makeRoot(t);
  const source = path.join(root, "global", "secret-skill");
  const destination = path.join(root, "project", "secret-skill");
  writeSkill(source, "secret-skill");
  fs.writeFileSync(path.join(source, "script.py"), 'API_KEY = "PRIVATE_LITERAL_SECRET_123456"\n');

  assert.throws(() => copySanitizedSkill({source, destination}), /literal secret/);
  assert.equal(fs.existsSync(destination), false);
});

test("quarantines a hash-pinned project Skill without claiming an exact canonical copy", t => {
  const root = makeRoot(t);
  const source = path.join(root, "skills", "project-only");
  writeSkill(source, "project-only");
  const audit = auditSkillTree(source);
  const {file, backupRoot, receiptPath} = writeManifest(root, [{
    id: "project-only",
    kind: "quarantine",
    source,
    expectedTreeHash: audit.treeHash
  }]);

  assert.equal(previewSkillPortfolio({manifestPath: file}).valid, true);
  const applied = applySkillPortfolio({manifestPath: file});
  assert.equal(applied.actions[0].canonical, null);
  assert.equal(fs.existsSync(source), false);
  assert.equal(auditSkillTree(path.join(backupRoot, "project-only")).treeHash, audit.treeHash);
  rollbackSkillPortfolio({receiptPath});
  assert.equal(auditSkillTree(source).treeHash, audit.treeHash);
});

test("restores the just-moved source when post-move verification fails", t => {
  const root = makeRoot(t);
  const source = path.join(root, "skills", "restore-on-failure");
  const canonical = path.join(root, "plugin", "restore-on-failure");
  writeSkill(source, "restore-on-failure");
  writeSkill(canonical, "restore-on-failure");
  const audit = auditSkillTree(source);
  const {file, backupRoot, receiptPath} = writeManifest(root, [{
    id: "restore-on-failure", source, canonical, expectedTreeHash: audit.treeHash
  }]);

  assert.throws(
    () => applySkillPortfolio({manifestPath: file}, {afterMove: () => { throw new Error("injected verification failure"); }}),
    /injected verification failure/
  );
  assert.equal(auditSkillTree(source).treeHash, audit.treeHash);
  assert.equal(fs.existsSync(path.join(backupRoot, "restore-on-failure")), false);
  assert.equal(fs.existsSync(receiptPath), false);
});
