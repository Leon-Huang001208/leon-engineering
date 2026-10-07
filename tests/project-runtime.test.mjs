import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import test from "node:test";

import {
  applyProjectRuntime,
  previewProjectRuntime,
  rollbackProjectRuntime,
  verifyProjectRuntime,
} from "../lib/project/managed-runtime.mjs";
import {HARNESS_RUNTIME_RESOURCES, installHarnessRuntime} from "../scripts/harness-runtime.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8"}).trim();
}

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-runtime-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test User"]);
  fs.mkdirSync(path.join(root, ".agents"), {recursive: true});
  fs.mkdirSync(path.join(root, "scripts"), {recursive: true});
  fs.writeFileSync(path.join(root, ".agents", "verification-policy.json"), "{\"projectOwned\":true}\n");
  fs.writeFileSync(path.join(root, "scripts", "plan_verification.mjs"), "// project-owned wrapper\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  return root;
}

function upgradedSource(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-runtime-source-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const relative of [".claude-plugin", "lib/verification", "schemas"]) {
    fs.cpSync(path.join(SOURCE_ROOT, relative), path.join(root, relative), {recursive: true});
  }
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "copied source"]);
  fs.appendFileSync(path.join(root, "lib", "verification", "errors.mjs"), "\n// upgraded fixture\n");
  const plugin = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  plugin.version = "0.19.4-test";
  fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), `${JSON.stringify(plugin, null, 2)}\n`);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "upgrade source"]);
  return root;
}

test("previews and applies a clean runtime without touching project policy or wrappers", t => {
  const projectRoot = project(t);
  const preview = previewProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  assert.equal(preview.valid, true);
  assert.equal(preview.action, "install");
  assert.equal(fs.existsSync(preview.runtimeRoot), false);

  const applied = applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  assert.equal(applied.status, "installed");
  assert.equal(fs.readFileSync(path.join(projectRoot, ".agents", "verification-policy.json"), "utf8"), "{\"projectOwned\":true}\n");
  assert.equal(fs.readFileSync(path.join(projectRoot, "scripts", "plan_verification.mjs"), "utf8"), "// project-owned wrapper\n");
  assert.equal(verifyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot}).valid, true);
  assert.equal(fs.statSync(applied.receiptPath).mode & 0o777, 0o600);
});

test("legacy runtime inventories upgrade and rollback, but cannot certify the new source bundle", async t => {
  const projectRoot = project(t);
  const applied = applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  const manifestPath = path.join(applied.runtimeRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const file of ["lib/verification/platform-task.mjs", "schemas/verification-plan-v4.schema.json", "schemas/verification-receipt-v3.schema.json"]) {
    fs.unlinkSync(path.join(applied.runtimeRoot, file));
    delete manifest.files[file];
  }
  manifest.protocols = {policy: 3, plan: 3, receipt: 2};
  const legacyCommit = "31be48bf7271421a30d05b3816e7f03d78ccffd4";
  for (const file of Object.keys(manifest.files)) {
    const content = execFileSync("git", ["show", `${legacyCommit}:${file}`], {cwd: SOURCE_ROOT});
    fs.writeFileSync(path.join(applied.runtimeRoot, file), content);
    manifest.files[file] = createHash("sha256").update(content).digest("hex");
  }
  manifest.sourceCommit = legacyCommit;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  assert.equal(verifyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot}).valid, false);
  assert.equal(previewProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot}).valid, true);
  const upgraded = applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  assert.equal(verifyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot}).valid, true);
  rollbackProjectRuntime({projectRoot, receiptPath: upgraded.receiptPath});
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")).protocols, manifest.protocols);
  assert.equal(fs.existsSync(path.join(applied.runtimeRoot, "lib/verification/platform-task.mjs")), false);
  const legacy = await import(pathToFileURL(path.join(applied.runtimeRoot, "lib/verification/index.mjs")).href);
  fs.copyFileSync(path.join(SOURCE_ROOT, "tests/fixtures/verification/rwb-v3/verification-policy.json"), path.join(projectRoot, ".agents/verification-policy.json"));
  const plan = legacy.planVerification({projectRoot, changedFiles: ["app/research_web/main.py"]});
  assert.equal(plan.schemaVersion, 3);
  const validations = new Map([...plan.tests, ...plan.documentation, ...plan.ci].map(item => [item.id, item]));
  const evidence = "legacy-evidence.txt";
  fs.writeFileSync(path.join(projectRoot, evidence), "Synthetic compatibility fixture, not platform acceptance.\n");
  const receipt = {
    schemaVersion: 2, changeSummary: plan.changeSummary, changedFiles: plan.changedFiles,
    plannedLevel: plan.requiredLevel, actualLevel: plan.requiredLevel, components: plan.components,
    platforms: plan.platforms, impact: plan.impact,
    executed: plan.receiptTemplate.requiredValidationIds.map(id => ({id, level: validations.get(id).level, status: "PASS", durationSeconds: 0, evidence})),
    external: plan.receiptTemplate.externalGateIds.map(id => ({id, status: "PASS", evidence})),
    realMachine: [], result: "PASS", mergeReady: true, releaseReady: true,
    uncoveredRisks: plan.uncoveredRisks, escalation: {required: false, targetLevel: null, reasons: []},
  };
  const planPath = path.join(projectRoot, "legacy-plan.json"), receiptPath = path.join(projectRoot, "legacy-receipt.json");
  fs.writeFileSync(planPath, JSON.stringify(plan)); fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal(legacy.validateVerificationReceipt({projectRoot, planPath: "legacy-plan.json", receiptPath: "legacy-receipt.json"}).valid, true);
});

test("repeated apply is idempotent and managed drift is rejected", t => {
  const projectRoot = project(t);
  applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  const repeated = applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  assert.equal(repeated.status, "unchanged");

  const target = path.join(projectRoot, ".agents", "runtime", "leon-engineering", "lib", "verification", "planner.mjs");
  fs.appendFileSync(target, "// drift\n");
  const verification = verifyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  assert.equal(verification.valid, false);
  assert.ok(verification.drift.some(item => item.includes("planner.mjs")));
  assert.throws(() => applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot}), /managed runtime drift/);
});

test("injected promotion failure leaves no partial runtime", t => {
  const projectRoot = project(t);
  assert.throws(
    () => applyProjectRuntime(
      {sourceRoot: SOURCE_ROOT, projectRoot},
      {beforePromote: () => { throw new Error("injected promotion failure"); }},
    ),
    /injected promotion failure/,
  );
  assert.equal(fs.existsSync(path.join(projectRoot, ".agents", "runtime", "leon-engineering")), false);
});

test("receipt publication failure restores the pre-apply state", t => {
  const projectRoot = project(t);
  assert.throws(
    () => applyProjectRuntime(
      {sourceRoot: SOURCE_ROOT, projectRoot},
      {beforeReceipt: () => { throw new Error("injected receipt failure"); }},
    ),
    /injected receipt failure/,
  );
  assert.equal(fs.existsSync(path.join(projectRoot, ".agents", "runtime", "leon-engineering")), false);
});

test("refuses a symbolic-link project runtime parent", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-runtime-link-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-runtime-external-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  git(root, ["init", "-q"]);
  fs.symlinkSync(external, path.join(root, ".agents"));
  assert.throws(() => previewProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot: root}), /symbolic link/);
});

test("rollback removes only an owned clean install and refuses later drift", t => {
  const first = project(t);
  const applied = applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot: first});
  const rolledBack = rollbackProjectRuntime({projectRoot: first, receiptPath: applied.receiptPath});
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(fs.existsSync(path.join(first, ".agents", "runtime", "leon-engineering")), false);
  assert.equal(fs.existsSync(path.join(first, ".agents", "verification-policy.json")), true);

  const drifted = project(t);
  const second = applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot: drifted});
  fs.appendFileSync(
    path.join(drifted, ".agents", "runtime", "leon-engineering", "lib", "verification", "policy.mjs"),
    "// drift\n",
  );
  assert.throws(() => rollbackProjectRuntime({projectRoot: drifted, receiptPath: second.receiptPath}), /runtime drift/);
});

test("upgrade rollback restores the exact previously managed runtime", t => {
  const projectRoot = project(t);
  applyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot});
  const upgradeRoot = upgradedSource(t);
  const upgraded = applyProjectRuntime({sourceRoot: upgradeRoot, projectRoot});
  assert.equal(upgraded.status, "upgraded");
  assert.equal(verifyProjectRuntime({sourceRoot: upgradeRoot, projectRoot}).valid, true);
  rollbackProjectRuntime({projectRoot, receiptPath: upgraded.receiptPath});
  assert.equal(verifyProjectRuntime({sourceRoot: SOURCE_ROOT, projectRoot}).valid, true);
});

test("Harness distribution declares every verification library and schema resource", () => {
  const destinations = new Set(HARNESS_RUNTIME_RESOURCES.map(item => item.destination));
  for (const relative of [
    "lib/verification/binding.mjs",
    "lib/verification/changed-files.mjs",
    "lib/verification/errors.mjs",
    "lib/verification/index.mjs",
    "lib/verification/path-safety.mjs",
    "lib/verification/planner.mjs",
    "lib/verification/policy.mjs",
    "lib/verification/receipt.mjs",
    "schemas/verification-policy-v3.schema.json",
    "schemas/verification-plan-v3.schema.json",
    "schemas/verification-receipt-v2.schema.json"
  ]) assert.equal(destinations.has(relative), true, relative);
});

test("installed Harness verification and project-runtime CLIs resolve their managed libraries", t => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leon-runtime-cli-"));
  t.after(() => fs.rmSync(runtimeRoot, {recursive: true, force: true}));
  installHarnessRuntime({sourceRoot: SOURCE_ROOT, runtimeRoot});
  for (const script of ["verification-plan.mjs", "validate-verification-receipt.mjs", "project-runtime.mjs"]) {
    const result = spawnSync(process.execPath, [path.join(runtimeRoot, script), "--help"], {encoding: "utf8"});
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    assert.match(result.stdout, /用法/, script);
  }
});
