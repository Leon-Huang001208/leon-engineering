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

function makeHarnessFixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-evaluation-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture instructions\n");
  writeFile(path.join(project, ".ai", "harness", "metrics.jsonl"), "{\"event\":\"fixture\"}\n");
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
  return project;
}

test("summarizes terminal evidence without writing or running project commands", t => {
  const project = makeHarnessFixture(t);
  const metrics = path.join(project, ".ai", "harness", "metrics.jsonl");
  const before = fs.readFileSync(metrics, "utf8");

  const result = evaluateHarness({projectRoot: project});

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
    blockerCategories: {environment: 1}
  });
  assert.match(formatEvaluation(result, "markdown"), /一次通过率.*50%/);
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

  const result = spawnSync(process.execPath, [script, "--project", project, "--format", "markdown"], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Harness 交付评估/m);
  assert.match(result.stdout, /验证耗时覆盖率：50%/);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});
