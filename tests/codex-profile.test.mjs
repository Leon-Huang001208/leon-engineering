import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  previewProfile,
  applyProfile,
  rollbackProfile,
  validateExperimentManifest
} from "../scripts/codex-profile.mjs";

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-codex-profile-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const configPath = path.join(root, "config.toml");
  const profilePath = path.join(root, "profile.json");
  const backupPath = path.join(root, "private", "config.backup.toml");
  const receiptPath = path.join(root, "private", "receipt.json");
  const original = [
    "# preserve this comment",
    'model = "gpt-example"',
    'model_reasoning_effort = "high" # preserve suffix',
    'approval_policy = "on-request"',
    "",
    '[mcp_servers.private]',
    'api_key = "PRIVATE_CONFIG_CANARY"',
    "",
    '[plugins."alpha@example"]',
    "enabled = true # alpha comment",
    "",
    '[plugins."beta@example"]',
    "enabled = false",
    ""
  ].join("\n");
  fs.writeFileSync(configPath, original, {mode: 0o600});
  fs.writeFileSync(profilePath, `${JSON.stringify({
    schemaVersion: 1,
    model_reasoning_effort: "medium",
    plugins: {"alpha@example": false, "beta@example": true}
  }, null, 2)}\n`);
  return {root, configPath, profilePath, backupPath, receiptPath, original};
}

test("previews, applies, and rolls back only allowlisted profile values", t => {
  const fixture = makeFixture(t);

  const preview = previewProfile(fixture);
  assert.deepEqual(preview.changes, [
    {field: "model_reasoning_effort", before: "high", after: "medium"},
    {field: 'plugins."alpha@example".enabled', before: true, after: false},
    {field: 'plugins."beta@example".enabled', before: false, after: true}
  ]);
  assert.equal(fs.readFileSync(fixture.configPath, "utf8"), fixture.original);

  const applied = applyProfile(fixture);
  assert.equal(applied.status, "applied");
  const changed = fs.readFileSync(fixture.configPath, "utf8");
  assert.match(changed, /model_reasoning_effort = "medium" # preserve suffix/);
  assert.match(changed, /enabled = false # alpha comment/);
  assert.match(changed, /\[mcp_servers\.private\]\napi_key = "PRIVATE_CONFIG_CANARY"/);
  assert.equal(fs.readFileSync(fixture.backupPath, "utf8"), fixture.original);
  assert.equal(fs.statSync(fixture.backupPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(fixture.receiptPath).mode & 0o777, 0o600);
  assert.deepEqual(previewProfile(fixture).changes, []);

  const rolledBack = rollbackProfile({
    configPath: fixture.configPath,
    backupPath: fixture.backupPath,
    receiptPath: fixture.receiptPath
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(fs.readFileSync(fixture.configPath, "utf8"), fixture.original);
});

test("rejects invalid profile keys and unknown plugins", t => {
  const fixture = makeFixture(t);
  fs.writeFileSync(fixture.profilePath, JSON.stringify({schemaVersion: 1, model: "forbidden", plugins: {}}));
  assert.throws(() => previewProfile(fixture), /invalid profile keys/);
  fs.writeFileSync(fixture.profilePath, JSON.stringify({schemaVersion: 1, plugins: {"missing@example": false}}));
  assert.throws(() => previewProfile(fixture), /unknown configured plugin/);
});

test("refuses stale apply and rollback state", t => {
  const fixture = makeFixture(t);
  fs.mkdirSync(path.dirname(fixture.backupPath), {recursive: true});
  fs.writeFileSync(fixture.backupPath, "foreign");
  assert.throws(() => applyProfile(fixture), /backup already exists/);
  fs.rmSync(fixture.backupPath);
  applyProfile(fixture);
  fs.appendFileSync(fixture.configPath, "# drift\n");
  assert.throws(() => rollbackProfile({
    configPath: fixture.configPath,
    backupPath: fixture.backupPath,
    receiptPath: fixture.receiptPath
  }), /current config drifted/);
});

test("validates the fixed Token A-B experiment evidence schema", () => {
  const sample = {
    schemaVersion: 1,
    commit: "0123456789abcdef0123456789abcdef01234567",
    promptHash: "a".repeat(64),
    model: "gpt-example",
    reasoning: "medium",
    calls: 3,
    tools: 2,
    tokens: {input: 100, cachedInput: 80, nonCachedInput: 20, output: 10, reasoning: 5, weighted: 35},
    errors: 0,
    permissions: "unchanged",
    gates: "passed",
    qualityGrade: "correct"
  };
  assert.deepEqual(validateExperimentManifest(sample), sample);
  assert.throws(() => validateExperimentManifest({...sample, qualityGrade: "probably"}), /invalid experiment manifest/);
});
