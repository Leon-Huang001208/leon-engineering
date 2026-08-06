import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {buildHarness, recordOutcome, startHarnessSession, writeHarness} from "../scripts/harness-project.mjs";
import {enforceHarnessTask} from "../scripts/harness-enforce.mjs";

function makeProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-enforce-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
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
