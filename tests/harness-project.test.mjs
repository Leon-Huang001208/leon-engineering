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
  assert.match(formatAgentMap(harness), /verifier-test-[a-f0-9]{12}/);
  assert.match(formatAgentMap(harness), /cwd `\.`.*source `package\.json`.*non-interactive/);
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
  const verifierManifest = JSON.parse(fs.readFileSync(files.verifiers, "utf8"));
  assert.equal(verifierManifest.schemaVersion, 1);
  assert.equal(verifierManifest.projectRoot, fs.realpathSync(project));
  assert.deepEqual(verifierManifest.verifiers, harness.profile.commands.map(command => ({
    id: command.verifierId,
    kind: command.kind,
    command: command.command,
    argv: command.argv,
    workingDirectory: command.workingDirectory,
    source: command.source,
    interactive: false
  })));
  assert.equal(fs.statSync(files.verifiers).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(files.task, "utf8")).status, "ready");
  assert.equal(JSON.parse(fs.readFileSync(files.metrics, "utf8")).event, "task_created");
  const createdIndex = fs.readFileSync(files.index, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(createdIndex.length, 1);
  assert.deepEqual(createdIndex[0], {
    schemaVersion: 1,
    taskId: "default-greeting",
    outcomeCount: 0,
    terminalStatus: null,
    verificationStatus: "not_run",
    updatedAt: createdIndex[0].updatedAt
  });
  assert.match(createdIndex[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
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
  const completedIndex = fs.readFileSync(files.index, "utf8").trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(completedIndex.outcomeCount, 1);
  assert.equal(completedIndex.terminalStatus, "completed");
  assert.equal(completedIndex.verificationStatus, "passed");
  assert.deepEqual(completedIndex.outcome, {
    status: "completed",
    clarificationRounds: 1,
    reworkCount: 0,
    verificationStatus: "passed",
    verificationDurationSeconds: 12
  });
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

test("refuses outcome writes through a symbolic-link task index", t => {
  const project = makeFixture(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "index-safety", goal: "protect index", acceptanceCriteria: ["external file unchanged"]}
  });
  const files = writeHarness({projectRoot: project, harness});
  const external = path.join(project, "external-index.jsonl");
  fs.writeFileSync(external, "sentinel\n");
  fs.rmSync(files.index);
  fs.symlinkSync(external, files.index);

  assert.throws(() => recordOutcome({
    projectRoot: project,
    taskId: "index-safety",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "node --test",
      verificationStatus: "passed",
      verificationDurationSeconds: 1
    }
  }), /invalid harness file/);
  assert.equal(fs.readFileSync(external, "utf8"), "sentinel\n");
  assert.equal(JSON.parse(fs.readFileSync(files.task, "utf8")).status, "ready");
});

test("records reasoning method selection and completion without prompt or chain-of-thought fields", t => {
  const project = makeFixture(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "method-audit", goal: "private goal", acceptanceCriteria: ["private acceptance"]}
  });
  writeHarness({projectRoot: project, harness});

  const selected = appendHarnessEvent({
    projectRoot: project,
    taskId: "method-audit",
    event: {
      event: "reasoning_method_selected",
      host: "codex",
      methodId: "first-principles",
      methodVersion: "1.0.0",
      source: "user-selected"
    }
  });
  const completed = appendHarnessEvent({
    projectRoot: project,
    taskId: "method-audit",
    event: {
      event: "reasoning_method_completed",
      host: "codex",
      methodId: "first-principles",
      methodVersion: "1.0.0",
      artifactRef: "artifact:decision-variables"
    }
  });

  assert.equal(selected.source, "user-selected");
  assert.equal(completed.artifactRef, "artifact:decision-variables");
  assert.throws(() => appendHarnessEvent({
    projectRoot: project,
    taskId: "method-audit",
    event: {
      event: "reasoning_method_selected",
      host: "codex",
      methodId: "first-principles",
      methodVersion: "1.0.0",
      source: "user-selected",
      prompt: "private prompt"
    }
  }), /invalid harness event field/);
});

test("CLI records reasoning method audit events", t => {
  const project = makeFixture(t);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "method-cli", goal: "private goal", acceptanceCriteria: ["private acceptance"]}
  });
  writeHarness({projectRoot: project, harness});
  const script = path.join(sourceRoot, "scripts", "harness-project.mjs");

  const selected = spawnSync(process.execPath, [
    script, "--project", project, "--task-id", "method-cli", "--record-method-selected",
    "--host", "claude", "--method-id", "fact-checking", "--method-version", "1.0.0", "--method-source", "required"
  ], {encoding: "utf8"});
  const completed = spawnSync(process.execPath, [
    script, "--project", project, "--task-id", "method-cli", "--record-method-completed",
    "--host", "claude", "--method-id", "fact-checking", "--method-version", "1.0.0", "--artifact-ref", "artifact:claim-table"
  ], {encoding: "utf8"});

  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(completed.status, 0, completed.stderr);
  assert.deepEqual(readHarnessEvents({projectRoot: project, taskId: "method-cli"}).map(event => event.event), [
    "reasoning_method_selected", "reasoning_method_completed"
  ]);
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

test("resumes a structurally compatible version 2 session", t => {
  const project = makeFixture(t);
  const started = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "version-2-session",
    task: {id: "version-2-task", goal: "Resume v2", acceptanceCriteria: ["Existing task resumes"]}
  });
  const sessionFile = path.join(project, ".ai", "harness", "sessions", `${started.sessionKey}.json`);
  const context = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  fs.writeFileSync(sessionFile, `${JSON.stringify({...context, schemaVersion: 2}, null, 2)}\n`);

  const resumed = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "version-2-session",
    task: {id: "replacement-task", goal: "Do not replace", acceptanceCriteria: ["Original task remains"]}
  });

  assert.equal(resumed.resumed, true);
  assert.equal(resumed.taskId, "version-2-task");
  assert.equal(JSON.parse(fs.readFileSync(sessionFile, "utf8")).schemaVersion, 2);
});

test("rejects malformed and unsupported session contexts", t => {
  const cases = [
    ["schema zero", context => ({...context, schemaVersion: 0})],
    ["future schema", context => ({...context, schemaVersion: 3})],
    ["string schema", context => ({...context, schemaVersion: "2"})],
    ["wrong key", context => ({...context, schemaVersion: 2, sessionKey: "0".repeat(64)})],
    ["missing task", context => ({...context, schemaVersion: 2, taskId: undefined})],
    ["unsafe task", context => ({...context, schemaVersion: 2, taskId: "../outside"})],
    ["array", () => []],
    ["broken json", () => "{broken\n"]
  ];

  for (const [label, mutate] of cases) {
    const project = makeFixture(t);
    const sessionId = `invalid-${label.replaceAll(" ", "-")}`;
    const started = startHarnessSession({
      projectRoot: project,
      host: "codex",
      sessionId,
      task: {id: "valid-task", goal: "Reject invalid session", acceptanceCriteria: ["Session is rejected"]}
    });
    const sessionFile = path.join(project, ".ai", "harness", "sessions", `${started.sessionKey}.json`);
    const context = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const mutated = mutate(context);
    fs.writeFileSync(sessionFile, typeof mutated === "string" ? mutated : `${JSON.stringify(mutated, null, 2)}\n`);

    assert.throws(() => startHarnessSession({
      projectRoot: project,
      host: "codex",
      sessionId,
      task: {id: "replacement-task", goal: "Do not replace", acceptanceCriteria: ["Invalid session remains rejected"]}
    }), /invalid harness session/, label);
  }
});

test("requires an intact matching task record when resuming version 2 sessions", t => {
  const cases = [
    ["missing", taskFile => fs.rmSync(taskFile)],
    ["corrupt", taskFile => fs.writeFileSync(taskFile, "{broken\n")],
    ["mismatched", taskFile => fs.writeFileSync(taskFile, `${JSON.stringify({id: "another-task"})}\n`)]
  ];

  for (const [label, damage] of cases) {
    const project = makeFixture(t);
    const sessionId = `version-2-${label}-task-record`;
    const started = startHarnessSession({
      projectRoot: project,
      host: "codex",
      sessionId,
      task: {id: "version-2-task", goal: "Validate task record", acceptanceCriteria: ["Task record is required"]}
    });
    const sessionFile = path.join(project, ".ai", "harness", "sessions", `${started.sessionKey}.json`);
    const context = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    fs.writeFileSync(sessionFile, `${JSON.stringify({...context, schemaVersion: 2}, null, 2)}\n`);
    damage(path.join(project, ".ai", "harness", "tasks", "version-2-task.json"));

    assert.throws(() => startHarnessSession({
      projectRoot: project,
      host: "codex",
      sessionId,
      task: {id: "replacement-task", goal: "Do not replace", acceptanceCriteria: ["Damaged record is rejected"]}
    }), /missing harness task record|invalid task record/, label);
  }
});

test("rejects a version 2 session whose host does not match its scoped key", t => {
  const project = makeFixture(t);
  const started = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "version-2-host-mismatch",
    task: {id: "version-2-host-task", goal: "Reject mismatch", acceptanceCriteria: ["Host stays isolated"]}
  });
  const sessionFile = path.join(project, ".ai", "harness", "sessions", `${started.sessionKey}.json`);
  const context = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  fs.writeFileSync(sessionFile, `${JSON.stringify({...context, schemaVersion: 2, host: "claude"}, null, 2)}\n`);

  assert.throws(() => startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "version-2-host-mismatch",
    task: {id: "replacement-task", goal: "Do not replace", acceptanceCriteria: ["Mismatch is rejected"]}
  }), /invalid harness session/);
});

test("isolates identical opaque session ids by host", t => {
  const project = makeFixture(t);
  const claude = startHarnessSession({
    projectRoot: project,
    host: "claude",
    sessionId: "shared-session",
    task: {id: "claude-task", goal: "Claude task", acceptanceCriteria: ["Claude session starts"]}
  });
  const codex = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId: "shared-session",
    task: {id: "codex-task", goal: "Codex task", acceptanceCriteria: ["Codex session starts"]}
  });

  assert.equal(claude.resumed, false);
  assert.equal(codex.resumed, false);
  assert.notEqual(claude.sessionKey, codex.sessionKey);
  const contexts = fs.readdirSync(path.join(project, ".ai", "harness", "sessions"))
    .map(name => JSON.parse(fs.readFileSync(path.join(project, ".ai", "harness", "sessions", name), "utf8")));
  assert.deepEqual(contexts.map(context => context.host).sort(), ["claude", "codex"]);
});

test("migrates a same-host version 2 legacy session without overwriting the legacy file", t => {
  const project = makeFixture(t);
  const sessionId = "legacy-session";
  const legacyKey = crypto.createHash("sha256").update(sessionId).digest("hex");
  const started = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId,
    task: {id: "legacy-task", goal: "Legacy task", acceptanceCriteria: ["Legacy session resumes"]}
  });
  const sessions = path.join(project, ".ai", "harness", "sessions");
  const scopedFile = path.join(sessions, `${started.sessionKey}.json`);
  const legacyFile = path.join(sessions, `${legacyKey}.json`);
  const legacyContext = {...JSON.parse(fs.readFileSync(scopedFile, "utf8")), schemaVersion: 2, sessionKey: legacyKey};
  fs.writeFileSync(legacyFile, `${JSON.stringify(legacyContext, null, 2)}\n`);
  if (scopedFile !== legacyFile) fs.rmSync(scopedFile);
  const legacyBefore = fs.readFileSync(legacyFile, "utf8");

  const resumed = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId,
    task: {id: "replacement-task", goal: "Replacement", acceptanceCriteria: ["Original task remains"]}
  });

  assert.equal(resumed.resumed, true);
  assert.equal(resumed.taskId, "legacy-task");
  assert.notEqual(resumed.sessionKey, legacyKey);
  assert.equal(fs.readFileSync(legacyFile, "utf8"), legacyBefore);
  const migrated = JSON.parse(fs.readFileSync(path.join(sessions, `${resumed.sessionKey}.json`), "utf8"));
  assert.equal(migrated.taskId, "legacy-task");
  assert.equal(migrated.schemaVersion, 2);
});

test("preserves a cross-host legacy session while creating a scoped session", t => {
  const project = makeFixture(t);
  const sessionId = "cross-host-legacy";
  const legacyKey = crypto.createHash("sha256").update(sessionId).digest("hex");
  const claude = startHarnessSession({
    projectRoot: project,
    host: "claude",
    sessionId,
    task: {id: "legacy-claude-task", goal: "Claude legacy", acceptanceCriteria: ["Legacy remains"]}
  });
  const sessions = path.join(project, ".ai", "harness", "sessions");
  const claudeScopedFile = path.join(sessions, `${claude.sessionKey}.json`);
  const legacyFile = path.join(sessions, `${legacyKey}.json`);
  const legacyContext = {...JSON.parse(fs.readFileSync(claudeScopedFile, "utf8")), sessionKey: legacyKey};
  fs.writeFileSync(legacyFile, `${JSON.stringify(legacyContext, null, 2)}\n`);
  if (claudeScopedFile !== legacyFile) fs.rmSync(claudeScopedFile);
  const legacyBefore = fs.readFileSync(legacyFile, "utf8");

  const codex = startHarnessSession({
    projectRoot: project,
    host: "codex",
    sessionId,
    task: {id: "scoped-codex-task", goal: "Codex scoped", acceptanceCriteria: ["Codex session starts"]}
  });

  assert.equal(codex.resumed, false);
  assert.equal(codex.taskId, "scoped-codex-task");
  assert.notEqual(codex.sessionKey, legacyKey);
  assert.equal(fs.readFileSync(legacyFile, "utf8"), legacyBefore);
  assert.equal(JSON.parse(fs.readFileSync(path.join(sessions, `${codex.sessionKey}.json`), "utf8")).host, "codex");
});

test("preserves an opposite-host version 2 legacy session while creating a scoped session", t => {
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
  const legacy = {schemaVersion: 2, sessionKey: legacyKey, taskId: "legacy-claude-task", host: "claude", startedAt: "2026-09-09T00:00:00.000Z"};
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
