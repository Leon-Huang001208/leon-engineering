import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {evaluateHarness, formatEvaluation} from "../scripts/harness-evaluate.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

function writeTask(project, id, task) {
  writeFile(path.join(project, ".ai", "harness", "tasks", `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
}

function writeIndex(project, records) {
  writeFile(
    path.join(project, ".ai", "harness", "task-index.jsonl"),
    records.map(record => JSON.stringify(record)).join("\n") + "\n"
  );
}

function makeHarnessFixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-evaluation-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture instructions\n");
  writeFile(path.join(project, ".ai", "harness", "agent-map.md"), "# Fixture map\n");
  writeFile(path.join(project, ".ai", "harness", "metrics.jsonl"), [
    {event: "fixture"},
    {timestamp: "2026-09-14T00:00:03.000Z", event: "observation_recorded", taskId: "first-pass", verifierId: "verifier-test-111111111111", status: "passed", durationMs: 10, fullBytes: 100, returnedBytes: 50, truncated: true, archiveFailed: false},
    {timestamp: "2026-09-14T00:00:04.000Z", event: "observation_recorded", taskId: "first-pass", verifierId: "verifier-test-111111111111", status: "passed", durationMs: 20, fullBytes: 200, returnedBytes: 100, truncated: true, archiveFailed: false},
    {timestamp: "2026-09-14T00:00:05.000Z", event: "observation_recorded", taskId: "environment-blocker", verifierId: "verifier-lint-222222222222", status: "failed", durationMs: 30, fullBytes: 50, returnedBytes: 50, truncated: false, archiveFailed: true},
    {timestamp: "2026-09-14T00:00:06.000Z", event: "observation_recalled", taskId: "first-pass", verifierId: "verifier-test-111111111111", status: "passed", durationMs: 10, fullBytes: 100, returnedBytes: 50, truncated: true, archiveFailed: false, recallCount: 1}
  ].map(event => JSON.stringify(event)).join("\n") + "\n");
  writeFile(path.join(project, ".ai", "harness", "events.jsonl"), [
    {timestamp: "2026-09-14T00:00:00.000Z", taskId: "first-pass", event: "reasoning_method_selected", host: "codex", methodId: "first-principles", methodVersion: "1.0.0", source: "user-selected"},
    {timestamp: "2026-09-14T00:00:01.000Z", taskId: "first-pass", event: "reasoning_method_selected", host: "codex", methodId: "minimal-experiment", methodVersion: "1.0.0", source: "recommended"},
    {timestamp: "2026-09-14T00:00:02.000Z", taskId: "first-pass", event: "reasoning_method_completed", host: "codex", methodId: "first-principles", methodVersion: "1.0.0", artifactRef: "artifact:variables"}
  ].map(event => JSON.stringify(event)).join("\n") + "\n");
  writeTask(project, "first-pass", {
    id: "first-pass",
    status: "completed",
    outcomes: [{
      status: "completed",
      clarificationRounds: 1,
      reworkCount: 0,
      verification: {command: "this-command-must-not-run", status: "passed"},
      verificationDurationSeconds: 12
    }]
  });
  writeTask(project, "environment-blocker", {
    id: "environment-blocker",
    status: "blocked",
    outcomes: [{
      status: "blocked",
      clarificationRounds: 1,
      reworkCount: 1,
      verification: {command: "this-command-must-not-run", status: "not_run"},
      blockerCategory: "environment"
    }]
  });
  writeIndex(project, [
    {
      schemaVersion: 1,
      taskId: "first-pass",
      outcomeCount: 1,
      terminalStatus: "completed",
      verificationStatus: "passed",
      updatedAt: "2026-09-14T00:00:07.000Z",
      outcome: {status: "completed", clarificationRounds: 1, reworkCount: 0, verificationStatus: "passed", verificationDurationSeconds: 12}
    },
    {
      schemaVersion: 1,
      taskId: "environment-blocker",
      outcomeCount: 1,
      terminalStatus: "blocked",
      verificationStatus: "not_run",
      updatedAt: "2026-09-14T00:00:08.000Z",
      outcome: {status: "blocked", clarificationRounds: 1, reworkCount: 1, verificationStatus: "not_run", blockerCategory: "environment"}
    }
  ]);
  return project;
}

test("summarizes terminal evidence without writing or running project commands", t => {
  const project = makeHarnessFixture(t);
  const metrics = path.join(project, ".ai", "harness", "metrics.jsonl");
  const before = fs.readFileSync(metrics, "utf8");

  const result = evaluateHarness({projectRoot: project, all: true});

  assert.deepEqual(result.health, {
    complete: true,
    invalidIndexEntries: 0,
    unindexedTasks: [],
    timedOutRecords: []
  });

  assert.deepEqual(result.summary, {
    taskCount: 2,
    terminalTaskCount: 2,
    completedPassedCount: 1,
    firstPassCompletedCount: 1,
    firstPassRate: 0.5,
    averageClarificationRounds: 1,
    averageReworkCount: 0.5,
    verificationDurationCoverage: 0.5,
    averageVerificationDurationSeconds: 12,
    blockerCategories: {environment: 1},
    observations: {
      sampleSize: 3,
      fullBytes: 350,
      returnedBytes: 200,
      returnedByteRatio: 200 / 350,
      recallCount: 1,
      recallRate: 1 / 3,
      archiveFailureCount: 1,
      archiveFailureRate: 1 / 3,
      consistencySampleSize: 1,
      consistentVerifierCount: 1,
      verifierResultConsistencyRate: 1,
      statusCounts: {passed: 2, failed: 1}
    },
    reasoningMethods: {
      selectedCount: 2,
      completedCount: 1,
      tasksWithSelection: 1,
      adoptionRate: 0.5,
      combinationTaskCount: 1,
      completionRate: 0.5,
      byMethod: {
        "first-principles": {selected: 1, completed: 1, passedTasks: 1, reworkTasks: 0},
        "minimal-experiment": {selected: 1, completed: 0, passedTasks: 1, reworkTasks: 0}
      }
    }
  });
  assert.match(formatEvaluation(result, "markdown"), /一次通过率.*50%/);
  assert.match(formatEvaluation(result, "markdown"), /方法采用率.*50%/);
  assert.match(formatEvaluation(result, "markdown"), /Observation 样本：3/);
  assert.match(formatEvaluation(result, "markdown"), /返回字节比：57%/);
  assert.match(formatEvaluation(result, "markdown"), /回查率：33%/);
  assert.match(formatEvaluation(result, "markdown"), /归档失败率：33%/);
  assert.match(formatEvaluation(result, "markdown"), /verifier 结果一致率：100%.*1\/1/);
  assert.equal(fs.readFileSync(metrics, "utf8"), before);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});

test("rejects a symbolic-link task directory before reading an external file", t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-evaluation-link-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-evaluation-external-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture instructions\n");
  writeFile(path.join(project, ".ai", "harness", "metrics.jsonl"), "\n");
  writeFile(path.join(external, "outside.json"), "{}\n");
  fs.symlinkSync(external, path.join(project, ".ai", "harness", "tasks"));

  assert.throws(() => evaluateHarness({projectRoot: project}), /invalid harness directory/);
});

test("CLI renders a read-only markdown evaluation without running task commands", t => {
  const project = makeHarnessFixture(t);
  const script = path.join(sourceRoot, "scripts", "harness-evaluate.mjs");

  const result = spawnSync(process.execPath, [script, "--project", project, "--all", "--format", "markdown"], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Harness 交付评估/m);
  assert.match(result.stdout, /验证耗时覆盖率：50%/);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});

test("CLI displays Chinese usage for help without reading a project", () => {
  const script = path.join(sourceRoot, "scripts", "harness-evaluate.mjs");

  const result = spawnSync(process.execPath, [script, "--help"], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法：/);
  assert.match(result.stdout, /--project <项目目录>/);
  assert.match(result.stdout, /--task-id <任务 ID>/);
  assert.match(result.stdout, /--all/);
  assert.match(result.stdout, /--rebuild-index/);
  assert.match(result.stdout, /--format json\|markdown/);
});

test("targets one regular task record without scanning a damaged sibling", t => {
  const project = makeHarnessFixture(t);
  writeFile(path.join(project, ".ai", "harness", "tasks", "damaged.json"), "{not-json\n");

  const result = evaluateHarness({projectRoot: project, taskId: "first-pass"});

  assert.equal(result.summary.taskCount, 1);
  assert.equal(result.summary.completedPassedCount, 1);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});

test("rejects a damaged or symbolic-link targeted task record", async t => {
  await t.test("damaged JSON", () => {
    const project = makeHarnessFixture(t);
    writeFile(path.join(project, ".ai", "harness", "tasks", "first-pass.json"), "{not-json\n");
    assert.throws(() => evaluateHarness({projectRoot: project, taskId: "first-pass"}), /invalid task record/);
  });

  await t.test("symbolic link", () => {
    const project = makeHarnessFixture(t);
    const target = path.join(project, "external-task.json");
    writeFile(target, JSON.stringify({id: "first-pass", outcomes: []}));
    fs.rmSync(path.join(project, ".ai", "harness", "tasks", "first-pass.json"));
    fs.symlinkSync(target, path.join(project, ".ai", "harness", "tasks", "first-pass.json"));
    assert.throws(() => evaluateHarness({projectRoot: project, taskId: "first-pass"}), /invalid task record/);
  });
});

test("full evaluation reports an unindexed damaged sibling without reading it", t => {
  const project = makeHarnessFixture(t);
  writeFile(path.join(project, ".ai", "harness", "tasks", "damaged.json"), "{not-json\n");

  const result = evaluateHarness({projectRoot: project, all: true});
  assert.equal(result.health.complete, false);
  assert.deepEqual(result.health.unindexedTasks, ["damaged"]);
  assert.equal(result.summary.taskCount, 2);
});

test("CLI requires an explicit evaluation scope", t => {
  const project = makeHarnessFixture(t);
  const script = path.join(sourceRoot, "scripts", "harness-evaluate.mjs");
  const result = spawnSync(process.execPath, [script, "--project", project], {encoding: "utf8"});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /use --task-id or --all/);
});

test("CLI emits a partial report and exit code 2 for incomplete all-scope evidence", t => {
  const project = makeHarnessFixture(t);
  const script = path.join(sourceRoot, "scripts", "harness-evaluate.mjs");
  writeFile(path.join(project, ".ai", "harness", "tasks", "damaged.json"), "{not-json\n");
  const result = spawnSync(process.execPath, [script, "--project", project, "--all"], {encoding: "utf8"});
  assert.equal(result.status, 2, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.health.complete, false);
  assert.deepEqual(body.health.unindexedTasks, ["damaged"]);
});

test("rebuild-index records valid tasks and reports damaged records without hiding them", t => {
  const project = makeHarnessFixture(t);
  const script = path.join(sourceRoot, "scripts", "harness-evaluate.mjs");
  fs.rmSync(path.join(project, ".ai", "harness", "task-index.jsonl"));
  writeFile(path.join(project, ".ai", "harness", "tasks", "damaged.json"), "{not-json\n");
  const result = spawnSync(process.execPath, [script, "--project", project, "--rebuild-index"], {encoding: "utf8"});
  assert.equal(result.status, 2, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.indexedTaskCount, 2);
  assert.deepEqual(body.invalidRecords, ["damaged"]);
  assert.deepEqual(body.timedOutRecords, []);
  const lines = fs.readFileSync(path.join(project, ".ai", "harness", "task-index.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(line => line.taskId).sort(), ["environment-blocker", "first-pass"]);
});

test("CLI accepts --task-id and remains read-only with damaged siblings", t => {
  const project = makeHarnessFixture(t);
  const script = path.join(sourceRoot, "scripts", "harness-evaluate.mjs");
  writeFile(path.join(project, ".ai", "harness", "tasks", "damaged.json"), "{not-json\n");

  const result = spawnSync(process.execPath, [script, "--project", project, "--task-id", "first-pass", "--format", "markdown"], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /任务：1 个/);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});
