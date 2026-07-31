import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {install, verify, rollback, SKILL_NAMES} from "../scripts/install-codex-adapter.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function makeTarget(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "leon-codex-adapter-"));
  t.after(() => fs.rmSync(target, {recursive: true, force: true}));
  return target;
}

test("installs every canonical skill and writes a checksum manifest", t => {
  const target = makeTarget(t);
  const result = install({sourceRoot, targetRoot: target});

  assert.deepEqual(result.skills, SKILL_NAMES);
  assert.equal(verify({sourceRoot, targetRoot: target}).valid, true);

  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".leon-engineering.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.skills).sort(), SKILL_NAMES);
});

test("refuses to overwrite a foreign skill directory", t => {
  const target = makeTarget(t);
  fs.mkdirSync(path.join(target, "feature-loop"));
  fs.writeFileSync(path.join(target, "feature-loop", "SKILL.md"), "foreign");

  assert.throws(() => install({sourceRoot, targetRoot: target}), /foreign skill directory/);
  assert.equal(fs.readFileSync(path.join(target, "feature-loop", "SKILL.md"), "utf8"), "foreign");
});

test("detects drift and preserves unrelated skills during rollback", t => {
  const target = makeTarget(t);
  install({sourceRoot, targetRoot: target});
  fs.appendFileSync(path.join(target, "bugfix-evidence", "SKILL.md"), "\nchanged");

  assert.deepEqual(verify({sourceRoot, targetRoot: target}).drift, ["bugfix-evidence"]);

  fs.mkdirSync(path.join(target, "pdf"));
  fs.writeFileSync(path.join(target, "pdf", "SKILL.md"), "existing");
  rollback({targetRoot: target});

  assert.equal(fs.existsSync(path.join(target, "feature-loop")), false);
  assert.equal(fs.readFileSync(path.join(target, "pdf", "SKILL.md"), "utf8"), "existing");
});
