import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {addHarnessTask, buildHarness, recordOutcome, writeHarness} from "../scripts/harness-project.mjs";
import {
  buildControlPlane,
  previewControlPlane,
  writeControlPlane,
  readControlPlane,
  transitionTask,
  retryTask,
  registerWorktree
} from "../scripts/harness-control.mjs";

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

function makeFixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-control-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture instructions\n");
  writeFile(path.join(project, "package.json"), JSON.stringify({scripts: {test: "node --test"}}));
  return project;
}

function initializeHarness(project) {
  return writeHarness({
    projectRoot: project,
    harness: buildHarness({
      projectRoot: project,
      task: {id: "seed-task", goal: "Create the Harness boundary.", acceptanceCriteria: ["Harness exists."]}
    })
  });
}

function addPlanTasks(project) {
  for (const task of taskPlan()) {
    addHarnessTask({projectRoot: project, task});
  }
}

function taskPlan() {
  return [
    {id: "collect", harnessTaskId: "collect", goal: "Collect bounded evidence.", acceptanceCriteria: ["Evidence is recorded."], dependsOn: []},
    {id: "implement", harnessTaskId: "implement", goal: "Implement the change.", acceptanceCriteria: ["Focused tests pass."], dependsOn: ["collect"]},
    {id: "verify", harnessTaskId: "verify", goal: "Verify delivery.", acceptanceCriteria: ["Acceptance evidence exists."], dependsOn: ["implement"]}
  ];
}

test("builds a read-only dependency plan and rejects invalid DAGs", t => {
  const project = makeFixture(t);
  const control = buildControlPlane({projectRoot: project, tasks: taskPlan()});

  assert.equal(control.schemaVersion, 1);
  assert.equal(control.projectRoot, fs.realpathSync(project));
  assert.deepEqual(control.tasks.map(task => [task.id, task.status, task.attempts]), [
    ["collect", "ready", 0],
    ["implement", "planned", 0],
    ["verify", "planned", 0]
  ]);
  assert.deepEqual(previewControlPlane(control).readyTaskIds, ["collect"]);
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness", "control-plane.json")), false);

  assert.throws(() => buildControlPlane({
    projectRoot: project,
    tasks: [{...taskPlan()[0], dependsOn: ["missing"]}]
  }), /unknown dependency/);
  assert.throws(() => buildControlPlane({
    projectRoot: project,
    tasks: [
      {...taskPlan()[0], dependsOn: ["verify"]},
      ...taskPlan().slice(1)
    ]
  }), /dependency cycle/);
});

test("persists explicit state transitions, retries, and declared worktree recovery data", t => {
  const project = makeFixture(t);
  initializeHarness(project);
  addPlanTasks(project);
  const control = buildControlPlane({projectRoot: project, tasks: taskPlan()});
  const files = writeControlPlane({projectRoot: project, control});
  assert.equal(files.control, path.join(fs.realpathSync(project), ".ai", "harness", "control-plane.json"));

  transitionTask({projectRoot: project, taskId: "collect", status: "in_progress", reason: "开始收集本次任务证据"});
  assert.throws(
    () => transitionTask({projectRoot: project, taskId: "collect", status: "completed", reason: "不能把控制状态当作验证证据"}),
    /missing completed passed harness evidence/
  );
  recordOutcome({
    projectRoot: project,
    taskId: "collect",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "node --test tests/collect.test.mjs",
      verificationStatus: "passed",
      verificationDurationSeconds: 1
    }
  });
  transitionTask({projectRoot: project, taskId: "collect", status: "completed", reason: "证据已保存"});
  let stored = readControlPlane({projectRoot: project});
  assert.equal(stored.tasks.find(task => task.id === "implement").status, "ready");

  transitionTask({projectRoot: project, taskId: "implement", status: "in_progress", reason: "开始最小实现"});
  transitionTask({projectRoot: project, taskId: "implement", status: "failed", reason: "聚焦测试失败"});
  stored = retryTask({projectRoot: project, taskId: "implement", reason: "修正后由执行者显式重试"});
  assert.deepEqual(stored.tasks.find(task => task.id === "implement"), {
    id: "implement",
    harnessTaskId: "implement",
    goal: "Implement the change.",
    acceptanceCriteria: ["Focused tests pass."],
    dependsOn: ["collect"],
    status: "ready",
    attempts: 1,
    worktree: null
  });

  stored = registerWorktree({
    projectRoot: project,
    taskId: "implement",
    worktree: {path: "/tmp/existing-harness-worktree", branch: "codex/harness-p2", baseCommit: "03c0ca0"}
  });
  assert.deepEqual(stored.tasks.find(task => task.id === "implement").worktree, {
    path: "/tmp/existing-harness-worktree",
    branch: "codex/harness-p2",
    baseCommit: "03c0ca0"
  });
  assert.throws(() => transitionTask({projectRoot: project, taskId: "verify", status: "in_progress", reason: "不能跳过依赖"}), /invalid task transition/);
  assert.throws(() => retryTask({projectRoot: project, taskId: "collect", reason: "完成任务不能重试"}), /only blocked or failed tasks can retry/);
  const events = readControlPlane({projectRoot: project}).events.map(event => event.event);
  assert.deepEqual(events, ["control_plane_created", "task_transition", "task_transition", "dependency_unblocked", "task_transition", "task_transition", "task_retry", "worktree_registered"]);
});

test("CLI previews without writing and writes only with explicit commands", t => {
  const project = makeFixture(t);
  initializeHarness(project);
  addPlanTasks(project);
  const sourceRoot = path.resolve(import.meta.dirname, "..");
  const script = path.join(sourceRoot, "scripts", "harness-control.mjs");
  const plan = path.join(project, "control-plan.json");
  fs.writeFileSync(plan, JSON.stringify({tasks: taskPlan()}));

  const preview = spawnSync(process.execPath, [script, "--project", project, "--task-plan", plan], {encoding: "utf8"});
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).persisted, false);
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness", "control-plane.json")), false);

  const written = spawnSync(process.execPath, [script, "--project", project, "--task-plan", plan, "--write-control-plane"], {encoding: "utf8"});
  assert.equal(written.status, 0, written.stderr);
  assert.equal(JSON.parse(written.stdout).persisted, true);

  const started = spawnSync(process.execPath, [script, "--project", project, "--transition", "--task-id", "collect", "--status", "in_progress", "--reason", "执行者开始处理"], {encoding: "utf8"});
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).controlPlane.tasks.find(task => task.id === "collect").status, "in_progress");
  const shown = spawnSync(process.execPath, [script, "--project", project, "--show"], {encoding: "utf8"});
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).controlPlane.tasks.find(task => task.id === "collect").status, "in_progress");
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
  assert.doesNotMatch(fs.readFileSync(script, "utf8"), /node:child_process|execFile|spawnSync/);
});

test("refuses to persist a control plan unless every task has a matching Harness task record", t => {
  const project = makeFixture(t);
  initializeHarness(project);
  const control = buildControlPlane({projectRoot: project, tasks: taskPlan()});
  assert.throws(() => writeControlPlane({projectRoot: project, control}), /missing harness task record: collect/);
});

test("refuses control-plane writes through a symbolic-link harness directory", t => {
  const project = makeFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "leon-external-control-"));
  t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  fs.mkdirSync(path.join(project, ".ai"));
  fs.symlinkSync(external, path.join(project, ".ai", "harness"));
  const control = buildControlPlane({projectRoot: project, tasks: taskPlan()});
  assert.throws(() => writeControlPlane({projectRoot: project, control}), /invalid harness directory/);
});
