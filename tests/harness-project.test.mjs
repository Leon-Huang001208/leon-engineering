import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {buildHarness, formatAgentMap, writeHarness, recordOutcome} from "../scripts/harness-project.mjs";

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

function makeFixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-harness-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture instructions\n");
  writeFile(path.join(project, "docs", "ARCHITECTURE.md"), "# Fixture architecture\n");
  writeFile(path.join(project, "package.json"), JSON.stringify({scripts: {test: "node --test"}}));
  return project;
}

const sourceRoot = path.resolve(import.meta.dirname, "..");

test("builds a read-only agent map and task handoff without creating project files", t => {
  const project = makeFixture(t);

  const harness = buildHarness({
    projectRoot: project,
    task: {
      id: "default-greeting",
      goal: "Provide a safe default greeting.",
      acceptanceCriteria: ["The greeting has a default recipient.", "The focused test passes."]
    }
  });

  assert.equal(harness.schemaVersion, 1);
  assert.equal(harness.projectRoot, fs.realpathSync(project));
  assert.deepEqual(harness.task, {
    id: "default-greeting",
    goal: "Provide a safe default greeting.",
    acceptanceCriteria: ["The greeting has a default recipient.", "The focused test passes."],
    status: "ready",
    verification: {status: "not_run"}
  });
  assert.match(formatAgentMap(harness), /AGENTS\.md/);
  assert.match(formatAgentMap(harness), /npm test/);
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness")), false);
});

test("persists an explicit harness once and appends only declared outcome evidence", t => {
  const project = makeFixture(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {
      id: "default-greeting",
      goal: "Provide a safe default greeting.",
      acceptanceCriteria: ["The focused test passes."]
    }
  });

  const files = writeHarness({projectRoot: project, harness});
  assert.equal(files.directory, path.join(fs.realpathSync(project), ".ai", "harness"));
  assert.match(fs.readFileSync(files.map, "utf8"), /Read the task record/);
  assert.equal(JSON.parse(fs.readFileSync(files.task, "utf8")).status, "ready");
  assert.equal(JSON.parse(fs.readFileSync(files.metrics, "utf8")).event, "task_created");
  assert.throws(() => writeHarness({projectRoot: project, harness}), /existing harness or task/);

  const outcome = recordOutcome({
    projectRoot: project,
    taskId: "default-greeting",
    outcome: {
      status: "completed",
      clarificationRounds: 1,
      reworkCount: 0,
      verificationCommand: "npm test -- greeting",
      verificationStatus: "passed",
      verificationDurationSeconds: 12
    }
  });
  assert.deepEqual(outcome, {
    status: "completed",
    clarificationRounds: 1,
    reworkCount: 0,
    verification: {command: "npm test -- greeting", status: "passed"},
    verificationDurationSeconds: 12
  });
  const task = JSON.parse(fs.readFileSync(files.task, "utf8"));
  assert.equal(task.status, "completed");
  assert.equal(task.outcomes.length, 1);
  const events = fs.readFileSync(files.metrics, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(event => event.event), ["task_created", "task_outcome"]);

  const blocked = recordOutcome({
    projectRoot: project,
    taskId: "default-greeting",
    outcome: {
      status: "blocked",
      clarificationRounds: 0,
      reworkCount: 1,
      verificationCommand: "npm test -- greeting",
      verificationStatus: "not_run",
      verificationDurationSeconds: 0,
      blockerCategory: "environment"
    }
  });
  assert.equal(blocked.blockerCategory, "environment");
  assert.throws(() => recordOutcome({
    projectRoot: project,
    taskId: "default-greeting",
    outcome: {
      status: "blocked",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "npm test",
      verificationStatus: "not_run",
      verificationDurationSeconds: 0
    }
  }), /blocker category is required/);
  assert.throws(() => recordOutcome({
    projectRoot: project,
    taskId: "default-greeting",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "npm test",
      verificationStatus: "passed",
      verificationDurationSeconds: -1,
      blockerCategory: "environment"
    }
  }), /invalid verification duration seconds/);

  const invalidated = recordOutcome({
    projectRoot: project,
    taskId: "default-greeting",
    outcome: {
      status: "invalidated",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "node missing-script.mjs",
      verificationStatus: "not_run",
      verificationDurationSeconds: 0,
      invalidReason: "运行时路径不存在，历史通过结果无效"
    }
  });
  assert.equal(invalidated.invalidReason, "运行时路径不存在，历史通过结果无效");
  assert.equal(JSON.parse(fs.readFileSync(files.task, "utf8")).status, "invalidated");
});

test("CLI stays read-only until explicit persistence and never runs declared verification commands", t => {
  const project = makeFixture(t);
  const script = path.join(sourceRoot, "scripts", "harness-project.mjs");
  const task = ["--project", project, "--task-id", "default-greeting", "--goal", "Provide a safe default greeting.", "--acceptance", "The focused test passes."];

  const preview = spawnSync(process.execPath, [script, ...task], {encoding: "utf8"});
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).persisted, false);
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness")), false);

  const written = spawnSync(process.execPath, [script, ...task, "--write-harness"], {encoding: "utf8"});
  assert.equal(written.status, 0, written.stderr);
  assert.equal(JSON.parse(written.stdout).persisted, true);

  const outcome = spawnSync(process.execPath, [
    script, "--project", project, "--task-id", "default-greeting", "--record-outcome",
    "--status", "completed", "--clarification-rounds", "1", "--rework-count", "0",
    "--verification-command", "this-command-must-not-run", "--verification-status", "passed",
    "--verification-duration-seconds", "7"
  ], {encoding: "utf8"});
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.equal(JSON.parse(outcome.stdout).recorded, true);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});

test("refuses outcome writes through a symbolic-link harness directory", t => {
  const project = makeFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "leon-external-harness-"));
  t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  writeFile(path.join(external, "tasks", "default-greeting.json"), JSON.stringify({status: "ready"}));
  writeFile(path.join(external, "metrics.jsonl"), "");
  fs.mkdirSync(path.join(project, ".ai"));
  fs.symlinkSync(external, path.join(project, ".ai", "harness"));

  assert.throws(() => recordOutcome({
    projectRoot: project,
    taskId: "default-greeting",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "npm test",
      verificationStatus: "passed",
      verificationDurationSeconds: 1
    }
  }), /invalid harness directory/);
});
