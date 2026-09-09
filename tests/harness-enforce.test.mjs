import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {buildHarness, recordOutcome, startHarnessSession, writeHarness} from "../scripts/harness-project.mjs";
import {enforceHarnessTask} from "../scripts/harness-enforce.mjs";
import {
  cleanupDelivery,
  prepareDelivery,
  publishDelivery,
  refreshDeliveryStatus,
  startDelivery
} from "../scripts/iteration-delivery.mjs";

function makeProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-enforce-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
  return project;
}

function git(cwd, args) {
  return spawnSync("git", ["-C", cwd, ...args], {encoding: "utf8"});
}

function makeGitProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-delivery-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, "project");
  const remote = path.join(root, "origin.git");
  fs.mkdirSync(project);
  assert.equal(spawnSync("git", ["init", "--bare", remote]).status, 0);
  assert.equal(spawnSync("git", ["init", project]).status, 0);
  assert.equal(git(project, ["config", "user.name", "Test"]).status, 0);
  assert.equal(git(project, ["config", "user.email", "test@example.com"]).status, 0);
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
  assert.equal(git(project, ["add", "."]).status, 0);
  assert.equal(git(project, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "seed"]).status, 0);
  assert.equal(git(project, ["branch", "-M", "main"]).status, 0);
  assert.equal(git(project, ["remote", "add", "origin", remote]).status, 0);
  assert.equal(git(project, ["push", "-u", "origin", "main"]).status, 0);
  assert.equal(spawnSync("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]).status, 0);
  assert.equal(git(project, ["remote", "set-head", "origin", "-a"]).status, 0);
  return project;
}

function start(project, taskId = "delivery") {
  return startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: `session-${taskId}`,
    task: {id: taskId, goal: "交付", acceptanceCriteria: ["验证"]}
  });
}

const sourceRoot = path.resolve(import.meta.dirname, "..");

test("rejects a task without a started session or passing verification", t => {
  const project = makeProject(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "delivery", goal: "交付", acceptanceCriteria: ["验证"]}
  });
  writeHarness({projectRoot: project, harness});

  assert.throws(() => enforceHarnessTask({projectRoot: project, taskId: "delivery"}), /missing task_started event/);
  start(project);
  assert.throws(() => enforceHarnessTask({projectRoot: project, taskId: "delivery"}), /latest outcome is not completed\/passed/);
});

test("accepts an automatically started task only after a real passed result is recorded", t => {
  const project = makeProject(t);
  start(project);
  recordOutcome({
    projectRoot: project,
    taskId: "delivery",
    host: "codex",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "node --test tests/focused.mjs",
      verificationStatus: "passed",
      verificationDurationSeconds: 4
    }
  });

  assert.deepEqual(enforceHarnessTask({projectRoot: project, taskId: "delivery"}), {
    taskId: "delivery",
    verificationStatus: "passed",
    verificationDurationSeconds: 4
  });
});

test("enforcement CLI is read-only, fails closed and documents its usage", t => {
  const project = makeProject(t);
  const script = path.join(sourceRoot, "scripts", "harness-enforce.mjs");
  const missing = spawnSync(process.execPath, [script, "--project", project, "--task-id", "missing"], {encoding: "utf8"});
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /harness enforce failed/);
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);

  const help = spawnSync(process.execPath, [script, "--help"], {encoding: "utf8"});
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /只读交付硬门/);
});

test("refuses an event stream symbolic link before reading outside the project", t => {
  const project = makeProject(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-enforce-outside-"));
  t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
  start(project);
  fs.unlinkSync(path.join(project, ".ai", "harness", "events.jsonl"));
  fs.symlinkSync(path.join(outside, "events.jsonl"), path.join(project, ".ai", "harness", "events.jsonl"));

  assert.throws(() => enforceHarnessTask({projectRoot: project, taskId: "delivery"}), /invalid harness file/);
});

test("requires a live cleaned delivery receipt when the delivery gate is enabled", t => {
  const project = makeGitProject(t);
  start(project, "delivery-gated");
  recordOutcome({
    projectRoot: project,
    taskId: "delivery-gated",
    host: "codex",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "node --test",
      verificationStatus: "passed",
      verificationDurationSeconds: 1
    }
  });
  assert.throws(
    () => enforceHarnessTask({projectRoot: project, taskId: "delivery-gated", requireDelivery: true}),
    /missing delivery receipt/
  );

  const started = startDelivery({projectRoot: project, taskId: "delivery-gated", slug: "gate"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "ready\n");
  assert.equal(git(started.featureWorktree, ["add", "."]).status, 0);
  assert.equal(git(started.featureWorktree, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feature"]).status, 0);
  prepareDelivery({projectRoot: project, taskId: "delivery-gated"});
  publishDelivery({
    projectRoot: project,
    taskId: "delivery-gated",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "delivery-gated",
    resolveCiStatus: () => ({status: "not_configured", runs: []})
  });
  cleanupDelivery({projectRoot: project, taskId: "delivery-gated"});

  const result = enforceHarnessTask({projectRoot: project, taskId: "delivery-gated", requireDelivery: true});
  assert.equal(result.deliveryStatus, "cleaned");
  assert.equal(result.ciStatus, "not_configured");
});
