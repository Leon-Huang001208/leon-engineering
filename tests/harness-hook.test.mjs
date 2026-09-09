import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {handleHarnessHook} from "../scripts/harness-hook.mjs";
import {buildHarness, writeHarness} from "../scripts/harness-project.mjs";
import {installHarnessRuntime} from "../scripts/harness-runtime.mjs";

function makeProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-hook-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
  return project;
}

const sourceRoot = path.resolve(import.meta.dirname, "..");

function corruptSessionFiles(project, host, sessionId) {
  writeHarness({
    projectRoot: project,
    harness: buildHarness({
      projectRoot: project,
      task: {id: "corrupt-task", goal: "Fixture", acceptanceCriteria: ["Fixture"]}
    })
  });
  const sessions = path.join(project, ".ai", "harness", "sessions");
  fs.mkdirSync(sessions);
  for (const keySource of [sessionId, `${host}:${sessionId}`]) {
    const key = crypto.createHash("sha256").update(keySource).digest("hex");
    fs.writeFileSync(path.join(sessions, `${key}.json`), "not-json\n");
  }
}

test("Claude pre and post hooks create one opaque session and record no tool input", t => {
  const project = makeProject(t);
  const input = {
    cwd: project,
    session_id: "claude-session-01",
    tool_name: "Edit",
    tool_input: {file_path: "/private/.env", old_string: "token=secret-value"}
  };

  const pre = handleHarnessHook({phase: "pre", input});
  const post = handleHarnessHook({phase: "post", input});
  assert.deepEqual(pre, {decision: "allow", taskId: pre.taskId});
  assert.equal(post.decision, "allow");
  assert.equal(post.taskId, pre.taskId);
  const events = fs.readFileSync(path.join(project, ".ai", "harness", "events.jsonl"), "utf8");
  assert.match(events, /task_started/);
  assert.match(events, /tool_completed/);
  assert.doesNotMatch(events, /secret|\.env|private|token/i);
});

test("Claude pre hook fails closed when an eligible project has no opaque session id", t => {
  const project = makeProject(t);
  const result = handleHarnessHook({phase: "pre", input: {cwd: project, tool_name: "Write"}});

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /session id/);
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);
});

test("Codex apply_patch hooks record a write event", t => {
  const project = makeProject(t);
  const input = {cwd: project, session_id: "codex-session-01", tool_name: "apply_patch"};

  const pre = handleHarnessHook({phase: "pre", input, host: "codex"});
  const post = handleHarnessHook({phase: "post", input, host: "codex"});

  assert.equal(pre.decision, "allow");
  assert.equal(post.decision, "allow");
  const events = fs.readFileSync(path.join(project, ".ai", "harness", "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(event => [event.event, event.tool].filter(Boolean)), [
    ["task_started"],
    ["policy_decision", "write"],
    ["tool_completed", "write"]
  ]);
});

test("Claude post hook is non-blocking when it cannot identify a project", () => {
  assert.deepEqual(handleHarnessHook({
    phase: "post",
    input: {cwd: "/does/not/exist", session_id: "claude-session-01", tool_name: "Bash"}
  }), {decision: "allow", skipped: true});
});

test("initialization failure allows only diagnostic reads and fails closed otherwise", t => {
  const project = makeProject(t);
  const sessionId = "corrupt-session";
  corruptSessionFiles(project, "codex", sessionId);

  const diagnostic = handleHarnessHook({
    phase: "pre",
    host: "codex",
    input: {cwd: project, session_id: sessionId, tool_name: "Bash", tool_input: {command: "pwd"}}
  });
  const mutation = handleHarnessHook({
    phase: "pre",
    host: "codex",
    input: {cwd: project, session_id: sessionId, tool_name: "apply_patch"}
  });
  const unknown = handleHarnessHook({
    phase: "pre",
    host: "codex",
    input: {cwd: project, session_id: sessionId, tool_name: "MysteryTool"}
  });

  assert.equal(diagnostic.decision, "allow");
  assert.equal(diagnostic.degraded, true);
  assert.equal(diagnostic.operation, "diagnostic_read");
  assert.equal(mutation.decision, "deny");
  assert.equal(mutation.operation, "mutation");
  assert.equal(unknown.decision, "deny");
  assert.equal(unknown.operation, "unknown");
  for (const result of [diagnostic, mutation, unknown]) {
    assert.deepEqual(Object.keys(result.diagnostic).sort(), ["code", "manifestPath", "phase", "recovery", "runtimePath"]);
    assert.equal(result.diagnostic.phase, "pre");
    assert.equal(result.diagnostic.code, "invalid_harness_session");
    assert.equal(path.basename(result.diagnostic.runtimePath), "harness-runtime.mjs");
    assert.equal(path.basename(result.diagnostic.manifestPath), ".leon-engineering-harness-runtime.json");
    assert.match(result.diagnostic.recovery, /verify|安装/);
  }
});

test("pre-hook CLI emits one redacted structured diagnostic", t => {
  const project = makeProject(t);
  const sessionId = "corrupt-cli-session";
  const sentinel = "PRIVATE_HOOK_SENTINEL";
  corruptSessionFiles(project, "codex", sessionId);
  const script = path.join(sourceRoot, "scripts", "harness-hook.mjs");
  const result = spawnSync(process.execPath, [script, "--phase", "pre", "--host", "codex"], {
    encoding: "utf8",
    input: JSON.stringify({
      cwd: project,
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: {command: `echo ${sentinel}`}
    })
  });

  assert.equal(result.status, 0, result.stderr);
  const denial = JSON.parse(result.stdout);
  assert.equal(denial.hookSpecificOutput.permissionDecision, "deny");
  const lines = result.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  const diagnostic = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["code", "component", "manifestPath", "phase", "recovery", "runtimePath"]);
  assert.equal(diagnostic.component, "harness-hook");
  assert.equal(diagnostic.code, "invalid_harness_session");
  assert.doesNotMatch(result.stderr, new RegExp(sentinel));
  assert.doesNotMatch(result.stderr, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.stderr, new RegExp(sessionId));
});

test("an installed hook executes from a realpath-normalized temporary runtime", t => {
  const project = makeProject(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-installed-hook-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const runtimeRoot = path.join(root, "runtime");
  installHarnessRuntime({sourceRoot, runtimeRoot});

  const result = spawnSync(process.execPath, [path.join(runtimeRoot, "harness-hook.mjs"), "--phase", "pre", "--host", "codex"], {
    encoding: "utf8",
    input: JSON.stringify({cwd: project, session_id: "installed-hook-session", tool_name: "Bash", tool_input: {command: "pwd"}})
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness")), true);
});
