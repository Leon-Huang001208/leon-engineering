import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {classifyHookOperation, handleHarnessHook} from "../scripts/harness-hook.mjs";

function makeProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-hook-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
  return project;
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

test("classifies only explicit read-only recovery operations as diagnostic reads", () => {
  const runtime = path.join(os.homedir(), ".agents", "leon-engineering", "runtime", "harness-runtime.mjs");
  const cases = [
    [{tool_name: "Bash", tool_input: {command: "pwd"}}, "diagnostic_read"],
    [{tool_name: "exec_command", tool_input: {cmd: "sed -n '1,120p' AGENTS.md"}}, "diagnostic_read"],
    [{tool_name: "Bash", tool_input: {command: "rg -n Harness AGENTS.md"}}, "diagnostic_read"],
    [{tool_name: "Bash", tool_input: {command: "git status --short"}}, "diagnostic_read"],
    [{tool_name: "Bash", tool_input: {command: `node ${runtime} --verify`}}, "diagnostic_read"],
    [{tool_name: "apply_patch", tool_input: {}}, "mutation"],
    [{tool_name: "Bash", tool_input: {command: "git checkout -- AGENTS.md"}}, "mutation"],
    [{tool_name: "Bash", tool_input: {command: "git branch recovery-copy"}}, "mutation"],
    [{tool_name: "Bash", tool_input: {command: "sed -i '' 's/a/b/' AGENTS.md"}}, "mutation"],
    [{tool_name: "Bash", tool_input: {command: "python diagnose.py"}}, "unknown"],
    [{tool_name: "unrecognized", tool_input: {}}, "unknown"]
  ];

  for (const [input, expected] of cases) assert.equal(classifyHookOperation(input), expected, JSON.stringify(input));
});

test("initialization failure allows diagnostics but denies mutation and unknown operations", t => {
  const project = makeProject(t);
  const sessionId = "broken-session";
  const start = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: sessionId, tool_name: "Read", tool_input: {file_path: "AGENTS.md"}},
    host: "codex"
  });
  assert.equal(start.decision, "allow");
  const sessionKey = crypto.createHash("sha256").update(`codex:${sessionId}`).digest("hex");
  fs.writeFileSync(path.join(project, ".ai", "harness", "sessions", `${sessionKey}.json`), "{broken\n");

  const diagnostic = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: sessionId, tool_name: "exec_command", tool_input: {cmd: "pwd"}},
    host: "codex"
  });
  const mutation = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: sessionId, tool_name: "apply_patch", tool_input: {}},
    host: "codex"
  });
  const unknown = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: sessionId, tool_name: "Bash", tool_input: {command: "python diagnose.py"}},
    host: "codex"
  });

  assert.equal(diagnostic.decision, "allow");
  assert.equal(diagnostic.degraded, true);
  assert.equal(diagnostic.operationClass, "diagnostic_read");
  assert.equal(mutation.decision, "deny");
  assert.equal(mutation.operationClass, "mutation");
  assert.equal(unknown.decision, "deny");
  assert.equal(unknown.operationClass, "unknown");
  for (const result of [diagnostic, mutation, unknown]) {
    assert.equal(result.diagnostics.stage, "session_start");
    assert.equal(result.diagnostics.errorCode, "HARNESS_SESSION_INVALID");
    assert.match(result.diagnostics.runtimePath, /\.agents\/leon-engineering\/runtime$/);
    assert.match(result.diagnostics.manifestPath, /\.leon-engineering-harness-runtime\.json$/);
    assert.match(result.diagnostics.recovery, /--verify/);
    assert.doesNotMatch(JSON.stringify(result), /broken-session|\{broken/);
  }
});

test("missing session identity still permits pwd but keeps writes fail-closed", t => {
  const project = makeProject(t);
  const diagnostic = handleHarnessHook({phase: "pre", input: {cwd: project, tool_name: "Bash", tool_input: {command: "pwd"}}});
  const mutation = handleHarnessHook({phase: "pre", input: {cwd: project, tool_name: "Write", tool_input: {file_path: "demo.txt"}}});

  assert.equal(diagnostic.decision, "allow");
  assert.equal(diagnostic.diagnostics.errorCode, "HARNESS_SESSION_ID_MISSING");
  assert.equal(mutation.decision, "deny");
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);
});
