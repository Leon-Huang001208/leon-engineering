import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {REASONING_SKILL_NAMES, evaluateTriggerExample} from "../scripts/reasoning-skills.mjs";
import {install, rollback, verify} from "../scripts/install-codex-adapter.mjs";
import {installClaudeSkills, rollbackClaudeSkills, verifyClaudeSkills} from "../scripts/install-claude-adapter.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

test("ships ten versioned reasoning skills with executable trigger examples", () => {
  assert.equal(REASONING_SKILL_NAMES.length, 10);
  for (const name of REASONING_SKILL_NAMES) {
    const contract = JSON.parse(fs.readFileSync(path.join(sourceRoot, "plugins", "leon-engineering-workflows", "skills", name, "contract.json"), "utf8"));
    assert.equal(contract.methodId, name);
    assert.match(contract.version, /^1\.0\.0$/);
    assert.equal(contract.permissions, "none");
    assert.ok(contract.positiveExamples.length >= 2);
    assert.ok(contract.negativeExamples.length >= 2);
    for (const example of contract.positiveExamples) assert.equal(evaluateTriggerExample(contract, example), true, `${name}: ${example}`);
    for (const example of contract.negativeExamples) assert.equal(evaluateTriggerExample(contract, example), false, `${name}: ${example}`);
  }
});

test("installs the same canonical reasoning skills into isolated Codex and Claude homes", t => {
  const codexSkills = temporaryDirectory(t, "leon-reasoning-codex-");
  const claudeHome = temporaryDirectory(t, "leon-reasoning-claude-");

  install({sourceRoot, targetRoot: codexSkills});
  installClaudeSkills({sourceRoot, claudeHome});

  assert.equal(verify({sourceRoot, targetRoot: codexSkills}).valid, true);
  assert.equal(verifyClaudeSkills({sourceRoot, claudeHome}).valid, true);
  for (const name of REASONING_SKILL_NAMES) {
    assert.equal(fs.existsSync(path.join(codexSkills, name, "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(claudeHome, "skills", name, "SKILL.md")), true);
  }

  rollback({targetRoot: codexSkills});
  rollbackClaudeSkills({claudeHome});
  assert.equal(fs.existsSync(path.join(codexSkills, ".leon-engineering.json")), false);
  assert.equal(fs.existsSync(path.join(claudeHome, "skills", ".leon-engineering.json")), false);
});

test("Claude reasoning skill install refuses foreign names and drifted rollback", t => {
  const foreignHome = temporaryDirectory(t, "leon-reasoning-claude-foreign-");
  fs.mkdirSync(path.join(foreignHome, "skills", "first-principles"), {recursive: true});
  fs.writeFileSync(path.join(foreignHome, "skills", "first-principles", "SKILL.md"), "foreign\n");
  assert.throws(() => installClaudeSkills({sourceRoot, claudeHome: foreignHome}), /foreign skill directory/);

  const driftHome = temporaryDirectory(t, "leon-reasoning-claude-drift-");
  installClaudeSkills({sourceRoot, claudeHome: driftHome});
  fs.appendFileSync(path.join(driftHome, "skills", "first-principles", "SKILL.md"), "drift\n");
  assert.equal(verifyClaudeSkills({sourceRoot, claudeHome: driftHome}).valid, false);
  assert.throws(() => rollbackClaudeSkills({claudeHome: driftHome}), /refusing to rollback drifted skills/);
});
