import fs from "node:fs";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {appendHarnessEvent, buildHarness, formatAgentMap, readHarnessEvents, startHarnessSession, writeHarness, refreshAgentMap, recordOutcome} from "../scripts/harness-project.mjs";

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
    delivery: {required: false},
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

test("refreshes only the existing Agent Map and records an auditable event", t => {
  const project = makeFixture(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "default-greeting", goal: "Provide a safe default greeting.", acceptanceCriteria: ["The focused test passes."]}
  });
  const files = writeHarness({projectRoot: project, harness});
  writeFile(path.join(project, ".github", "workflows", "new-check.yml"), "name: new check\n");

  const refreshed = refreshAgentMap({projectRoot: project});
  assert.equal(refreshed.map, files.map);
  assert.match(fs.readFileSync(files.map, "utf8"), /new-check\.yml/);
  assert.equal(JSON.parse(fs.readFileSync(files.task, "utf8")).id, "default-greeting");
  const events = fs.readFileSync(files.metrics, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).event, "agent_map_refreshed");
});

test("records only whitelisted Harness event metadata and never stores task text", t => {
  const project = makeFixture(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "private-goal", goal: "不要泄露的任务目标", acceptanceCriteria: ["完成私有验收"]}
  });
  writeHarness({projectRoot: project, harness});

  const event = appendHarnessEvent({
    projectRoot: project,
    taskId: "private-goal",
    event: {event: "task_started", host: "codex"}
  });

  assert.deepEqual(Object.keys(event).sort(), ["event", "host", "taskId", "timestamp"]);
  assert.equal(event.event, "task_started");
  assert.throws(() => appendHarnessEvent({
    projectRoot: project,
    taskId: "private-goal",
    event: {event: "task_started", host: "codex", command: "cat .env"}
  }), /invalid harness event field/);
  assert.throws(() => appendHarnessEvent({
    projectRoot: project,
    taskId: "private-goal",
    event: {event: "unknown", host: "codex"}
  }), /invalid harness event name/);
  const events = fs.readFileSync(path.join(project, ".ai", "harness", "events.jsonl"), "utf8");
  assert.doesNotMatch(events, /不要泄露|私有验收|\.env/);
});

test("reads only the requested task events from a shared event stream", t => {
  const project = makeFixture(t);
  const primary = buildHarness({
    projectRoot: project,
    task: {id: "primary-task", goal: "主任务", acceptanceCriteria: ["保留主任务事件"]}
  });
  writeHarness({projectRoot: project, harness: primary});
  startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "primary-session",
    task: {id: "primary-task", goal: "主任务", acceptanceCriteria: ["保留主任务事件"]}
  });
  startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "secondary-session",
    task: {id: "secondary-task", goal: "次任务", acceptanceCriteria: ["隔离次任务事件"]}
  });
  appendHarnessEvent({
    projectRoot: project,
    taskId: "secondary-task",
    event: {event: "policy_decision", host: "codex", tool: "write", decision: "allow"}
  });

  const events = readHarnessEvents({projectRoot: project, taskId: "primary-task"});

  assert.deepEqual(events.map(event => event.event), ["task_started"]);
  assert.equal(events.every(event => event.taskId === "primary-task"), true);
});

test("starts or resumes a session without duplicating its task-start event", t => {
  const project = makeFixture(t);
  const started = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "thread-123",
    task: {id: "automatic-task", goal: "自动任务", acceptanceCriteria: ["记录任务"]}
  });
  const resumed = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "thread-123",
    task: {id: "another-task", goal: "不应替换", acceptanceCriteria: ["保留原任务"]}
  });

  assert.equal(started.taskId, "automatic-task");
  assert.equal(started.resumed, false);
  assert.equal(resumed.taskId, "automatic-task");
  assert.equal(resumed.resumed, true);
  const next = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "thread-123",
    newTask: true,
    task: {id: "next-task", goal: "下一项任务", acceptanceCriteria: ["建立新记录"]}
  });
  assert.equal(next.taskId, "next-task");
  assert.equal(next.resumed, false);
  const events = fs.readFileSync(path.join(project, ".ai", "harness", "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(event => event.event), ["task_started", "task_started"]);
  assert.doesNotMatch(JSON.stringify(events), /自动任务|记录任务|不应替换/);
});

test("scopes session records by host and preserves cross-host contexts", t => {
  const project = makeFixture(t);
  const claude = startHarnessSession({
    projectRoot: project,
    host: "claude",
    sessionId: "shared-thread-01",
    task: {id: "claude-task", goal: "Claude task", acceptanceCriteria: ["recorded"]}
  });
  const codex = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "shared-thread-01",
    task: {id: "codex-task", goal: "Codex task", acceptanceCriteria: ["recorded"]}
  });

  assert.notEqual(claude.sessionKey, codex.sessionKey);
  assert.equal(claude.taskId, "claude-task");
  assert.equal(codex.taskId, "codex-task");
  const sessions = fs.readdirSync(path.join(project, ".ai", "harness", "sessions"));
  assert.equal(sessions.length, 2);
});

test("copies a valid same-host legacy session into the host-scoped namespace", t => {
  const project = makeFixture(t);
  const sessionId = "legacy-thread-01";
  const started = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId,
    task: {id: "legacy-task", goal: "Legacy task", acceptanceCriteria: ["recorded"]}
  });
  const sessions = path.join(project, ".ai", "harness", "sessions");
  const scoped = path.join(sessions, `${started.sessionKey}.json`);
  const legacyKey = crypto.createHash("sha256").update(sessionId).digest("hex");
  const legacy = path.join(sessions, `${legacyKey}.json`);
  const context = JSON.parse(fs.readFileSync(scoped, "utf8"));
  context.sessionKey = legacyKey;
  fs.writeFileSync(legacy, `${JSON.stringify(context, null, 2)}\n`);
  fs.rmSync(scoped);

  const resumed = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId,
    task: {id: "replacement-task", goal: "Replacement", acceptanceCriteria: ["not used"]}
  });

  assert.equal(resumed.resumed, true);
  assert.equal(resumed.taskId, "legacy-task");
  assert.equal(fs.existsSync(legacy), true);
  assert.equal(fs.existsSync(scoped), true);
  assert.equal(JSON.parse(fs.readFileSync(scoped, "utf8")).sessionKey, started.sessionKey);
});

test("preserves an opposite-host legacy session while creating a scoped session", t => {
  const project = makeFixture(t);
  const sessionId = "legacy-opposite-host";
  const legacyKey = crypto.createHash("sha256").update(sessionId).digest("hex");
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "legacy-claude-task", goal: "Legacy Claude task", acceptanceCriteria: ["preserved"]}
  });
  writeHarness({projectRoot: project, harness});
  const sessions = path.join(project, ".ai", "harness", "sessions");
  fs.mkdirSync(sessions);
  const legacyFile = path.join(sessions, `${legacyKey}.json`);
  const legacy = {schemaVersion: 1, sessionKey: legacyKey, taskId: "legacy-claude-task", host: "claude", startedAt: "2026-09-09T00:00:00.000Z"};
  fs.writeFileSync(legacyFile, `${JSON.stringify(legacy, null, 2)}\n`);

  const codex = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId,
    newTask: true,
    task: {id: "new-codex-task", goal: "New Codex task", acceptanceCriteria: ["created"]}
  });

  assert.equal(codex.resumed, false);
  assert.equal(codex.taskId, "new-codex-task");
  assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, "utf8")), legacy);
  const scoped = JSON.parse(fs.readFileSync(path.join(sessions, `${codex.sessionKey}.json`), "utf8"));
  assert.equal(scoped.host, "codex");
  assert.equal(scoped.taskId, "new-codex-task");
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

test("project CLI displays usage without requiring project input", () => {
  const script = path.join(sourceRoot, "scripts", "harness-project.mjs");

  const result = spawnSync(process.execPath, [script, "--help"], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法：/);
  assert.match(result.stdout, /--write-harness/);
  assert.match(result.stdout, /--refresh-agent-map/);
});
