import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {installHarnessRuntime, verifyHarnessRuntime, HARNESS_RUNTIME_FILES} from "../scripts/harness-runtime.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-runtime-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test("installs a verified Harness runtime that can preview a real project", t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  const project = path.join(root, "project");
  fs.mkdirSync(project, {recursive: true});
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# rules\n");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({scripts: {test: "node --test"}}));

  const installed = installHarnessRuntime({sourceRoot, runtimeRoot});
  assert.ok(HARNESS_RUNTIME_FILES.includes("harness-storage.mjs"));
  assert.ok(HARNESS_RUNTIME_FILES.includes("token-audit.mjs"));
  assert.ok(HARNESS_RUNTIME_FILES.includes("harness-execution.mjs"));
  assert.ok(HARNESS_RUNTIME_FILES.includes("harness-run.mjs"));
  assert.ok(HARNESS_RUNTIME_FILES.includes("verification-plan.mjs"));
  assert.equal(installed.files.length, HARNESS_RUNTIME_FILES.length);
  assert.deepEqual(verifyHarnessRuntime({sourceRoot, runtimeRoot}), {valid: true, drift: []});
  for (const name of HARNESS_RUNTIME_FILES) assert.equal(fs.existsSync(path.join(runtimeRoot, name)), true);

  const installedRuntimeRoot = fs.realpathSync(runtimeRoot);
  const selfVerified = spawnSync(process.execPath, [
    path.join(installedRuntimeRoot, "harness-runtime.mjs"), "--verify", "--runtime-root", installedRuntimeRoot
  ], {encoding: "utf8"});
  assert.equal(selfVerified.status, 0, selfVerified.stderr);
  assert.deepEqual(JSON.parse(selfVerified.stdout), {valid: true, drift: []});

  const preview = spawnSync(process.execPath, [
    path.join(runtimeRoot, "harness-project.mjs"), "--project", project,
    "--task-id", "runtime-preview", "--goal", "验证运行时", "--acceptance", "不写入项目"
  ], {encoding: "utf8"});
  assert.equal(preview.status, 0, preview.stderr);
  assert.notEqual(preview.stdout, "", preview.stderr);
  assert.equal(JSON.parse(preview.stdout).persisted, false);
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness")), false);

  const runHelp = spawnSync(process.execPath, [path.join(runtimeRoot, "harness-run.mjs"), "--help"], {encoding: "utf8"});
  assert.equal(runHelp.status, 0, runHelp.stderr);
  assert.match(runHelp.stdout, /--verifier-id/);
  assert.match(runHelp.stdout, /--read-observation/);
});

test("detects runtime drift and refuses symbolic-link runtime roots", t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  installHarnessRuntime({sourceRoot, runtimeRoot});
  fs.appendFileSync(path.join(runtimeRoot, "harness-evaluate.mjs"), "\nchanged\n");
  assert.deepEqual(verifyHarnessRuntime({sourceRoot, runtimeRoot}).drift, ["harness-evaluate.mjs"]);

  const external = path.join(root, "external");
  fs.mkdirSync(external);
  const linked = path.join(root, "linked");
  fs.symlinkSync(external, linked);
  assert.throws(() => installHarnessRuntime({sourceRoot, runtimeRoot: linked}), /symbolic link/);
});

test("default verification rejects an internally consistent but stale runtime", t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  installHarnessRuntime({sourceRoot, runtimeRoot});

  const runtimeFile = path.join(runtimeRoot, "harness-session.mjs");
  const staleContent = `${fs.readFileSync(runtimeFile, "utf8")}\n// stale installed runtime\n`;
  fs.writeFileSync(runtimeFile, staleContent);
  const manifestFile = path.join(runtimeRoot, ".leon-engineering-harness-runtime.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.frameworkVersion = "0.15.1";
  manifest.files["harness-session.mjs"] = crypto.createHash("sha256").update(staleContent).digest("hex");
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.deepEqual(verifyHarnessRuntime({runtimeRoot}).drift, ["harness-session.mjs"]);
});

test("an installed runtime verifies itself against its recorded canonical source", t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  installHarnessRuntime({sourceRoot, runtimeRoot});

  const verified = spawnSync(process.execPath, [path.join(fs.realpathSync(runtimeRoot), "harness-runtime.mjs"), "--verify", "--runtime-root", runtimeRoot], {
    encoding: "utf8"
  });

  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(JSON.parse(verified.stdout), {valid: true, drift: []});
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, ".leon-engineering-harness-runtime.json"), "utf8"));
  assert.equal(manifest.sourceRoot, fs.realpathSync(sourceRoot));
});

test("installed hook reports missing and drifted runtime manifests without opening mutation", async t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  const project = path.join(root, "project");
  fs.mkdirSync(project, {recursive: true});
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# rules\n");
  installHarnessRuntime({sourceRoot, runtimeRoot});
  const hook = await import(`${pathToFileURL(path.join(runtimeRoot, "harness-hook.mjs")).href}?test=${Date.now()}`);
  const input = {cwd: project, session_id: "runtime-diagnostic", tool_name: "Bash", tool_input: {command: "pwd"}};
  const manifestPath = path.join(runtimeRoot, ".leon-engineering-harness-runtime.json");
  const manifest = fs.readFileSync(manifestPath, "utf8");

  fs.rmSync(manifestPath);
  const missing = hook.handleHarnessHook({phase: "pre", input, host: "codex"});
  assert.equal(missing.decision, "allow");
  assert.equal(missing.degraded, true);
  assert.equal(missing.diagnostic.code, "runtime_missing");

  fs.writeFileSync(manifestPath, manifest);
  fs.appendFileSync(path.join(runtimeRoot, "harness-evaluate.mjs"), "\n// drift\n");
  const drifted = hook.handleHarnessHook({phase: "pre", input: {...input, tool_name: "Write"}, host: "codex"});
  assert.equal(drifted.decision, "deny");
  assert.equal(drifted.diagnostic.code, "manifest_drift");
  assert.match(drifted.diagnostic.manifestPath, /\.leon-engineering-harness-runtime\.json$/);
});

test("an installed runtime verifies itself without treating its parent as canonical source", t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  installHarnessRuntime({sourceRoot, runtimeRoot});

  const result = spawnSync(process.execPath, [path.join(runtimeRoot, "harness-runtime.mjs"), "--verify", "--runtime-root", runtimeRoot], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {valid: true, drift: []});
});

test("verification of a missing runtime is read-only", t => {
  const root = makeRoot(t);
  const runtimeRoot = path.join(root, "missing-runtime");

  assert.deepEqual(verifyHarnessRuntime({sourceRoot: null, runtimeRoot}), {
    valid: false,
    drift: ["missing runtime directory"]
  });
  assert.equal(fs.existsSync(runtimeRoot), false);
});
