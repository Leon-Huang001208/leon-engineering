import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {classifyHookCommand, classifyHookOperation, handleHarnessHook} from "../scripts/harness-hook.mjs";

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

test("missing session identity allows only diagnostic reads", t => {
  const project = makeProject(t);
  const diagnostic = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, tool_name: "Bash", tool_input: {command: "pwd"}}
  });
  const unknown = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, tool_name: "Bash", tool_input: {command: "custom-doctor"}}
  });

  assert.equal(diagnostic.decision, "allow");
  assert.equal(diagnostic.degraded, true);
  assert.equal(diagnostic.classification, "diagnostic_read");
  assert.equal(diagnostic.diagnostic.stage, "session_identity");
  assert.equal(diagnostic.diagnostic.code, "missing_session_id");
  assert.equal(unknown.decision, "deny");
  assert.equal(unknown.classification, "unknown");
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);
});

test("classifies the degraded-mode command boundary conservatively", () => {
  const runtime = path.resolve(import.meta.dirname, "..", "scripts", "harness-runtime.mjs");
  const diagnosticReads = [
    {tool_name: "Read", tool_input: {file_path: "/tmp/AGENTS.md"}},
    {tool_name: "Bash", tool_input: {command: "pwd"}},
    {tool_name: "Bash", tool_input: {command: "sed -n '1,80p' AGENTS.md"}},
    {tool_name: "Bash", tool_input: {command: "rg --files -g AGENTS.md"}},
    {tool_name: "Bash", tool_input: {command: "git status --short --branch"}},
    {tool_name: "Bash", tool_input: {command: `node ${runtime} --verify`}}
  ];
  for (const input of diagnosticReads) assert.equal(classifyHookCommand(input), "diagnostic_read");

  const mutations = [
    {tool_name: "apply_patch", tool_input: {}},
    {tool_name: "Bash", tool_input: {command: "printf changed > AGENTS.md"}},
    {tool_name: "Bash", tool_input: {command: "git commit -am fix"}},
    {tool_name: "Bash", tool_input: {command: "git push origin main"}},
    {tool_name: "Bash", tool_input: {command: "node scripts/install-codex-adapter.mjs --install-global"}},
    {tool_name: "Bash", tool_input: {command: "python3 -m pip install package"}}
  ];
  for (const input of mutations) assert.equal(classifyHookCommand(input), "mutation");
  assert.equal(classifyHookCommand({tool_name: "Bash", tool_input: {command: "custom-doctor"}}), "unknown");
  assert.equal(classifyHookCommand({tool_name: "Bash", tool_input: {command: "rg TODO . | head"}}), "unknown");
  assert.equal(classifyHookCommand({tool_name: "Bash", tool_input: {command: "sed -n '1p' -e '1w leaked.txt' AGENTS.md"}}), "unknown");
});

test("initialization errors return structured redacted diagnostics", t => {
  const project = makeProject(t);
  const permissionError = Object.assign(new Error("EACCES: token=PRIVATE_SENTINEL"), {code: "EACCES"});
  const result = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: "codex-session-02", tool_name: "Write"},
    host: "codex",
    runtimeVerifier: () => { throw permissionError; }
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.classification, "mutation");
  assert.deepEqual(Object.keys(result.diagnostic).sort(), [
    "code", "manifestPath", "recoveryCommand", "runtimePath", "stage"
  ]);
  assert.equal(result.diagnostic.stage, "runtime_verify");
  assert.equal(result.diagnostic.code, "permission_denied");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
  assert.match(result.reason, /stage=runtime_verify/);
  assert.match(result.reason, /code=permission_denied/);
});

test("corrupt session state degrades reads but still blocks writes", t => {
  const project = makeProject(t);
  const invalidSession = () => { throw new Error("invalid harness session"); };
  const read = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: "codex-session-03", tool_name: "Bash", tool_input: {command: "git status"}},
    host: "codex",
    sessionStarter: invalidSession
  });
  const write = handleHarnessHook({
    phase: "pre",
    input: {cwd: project, session_id: "codex-session-03", tool_name: "Edit"},
    host: "codex",
    sessionStarter: invalidSession
  });

  assert.equal(read.decision, "allow");
  assert.equal(read.diagnostic.code, "invalid_session_state");
  assert.equal(write.decision, "deny");
  assert.equal(write.diagnostic.code, "invalid_session_state");
});

test("corrupt task state is exposed as a stable diagnostic code", t => {
  const project = makeProject(t);
  const input = {cwd: project, session_id: "codex-session-05", tool_name: "Write"};
  const started = handleHarnessHook({phase: "pre", input, host: "codex"});
  fs.writeFileSync(path.join(project, ".ai", "harness", "tasks", `${started.taskId}.json`), "not json\n");

  const result = handleHarnessHook({
    phase: "pre",
    input: {...input, tool_name: "Bash", tool_input: {command: "pwd"}},
    host: "codex"
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.degraded, true);
  assert.equal(result.diagnostic.stage, "session_start");
  assert.equal(result.diagnostic.code, "invalid_task_state");
});

test("resolves a nested project root and skips an unmarked directory", t => {
  const project = makeProject(t);
  const nested = path.join(project, "src", "feature");
  fs.mkdirSync(nested, {recursive: true});
  fs.writeFileSync(path.join(project, ".git"), "gitdir: fixture\n");
  fs.writeFileSync(path.join(nested, "AGENTS.md"), "# nested rules\n");
  const handled = handleHarnessHook({
    phase: "pre",
    input: {cwd: nested, session_id: "codex-session-04", tool_name: "Bash", tool_input: {command: "pwd"}},
    host: "codex"
  });
  assert.equal(handled.decision, "allow");
  assert.equal(fs.existsSync(path.join(project, ".ai", "harness")), true);
  assert.equal(fs.existsSync(path.join(nested, ".ai")), false);

  const unmarked = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-unmarked-"));
  t.after(() => fs.rmSync(unmarked, {recursive: true, force: true}));
  assert.deepEqual(handleHarnessHook({
    phase: "pre",
    input: {cwd: unmarked, tool_name: "Write"},
    host: "codex"
  }), {decision: "allow", skipped: true});
  assert.equal(fs.existsSync(path.join(unmarked, ".ai")), false);
});

test("hook CLI emits an allow decision with structured degraded diagnostics", t => {
  const project = makeProject(t);
  const script = path.resolve(import.meta.dirname, "..", "scripts", "harness-hook.mjs");
  const executed = spawnSync(process.execPath, [script, "--phase", "pre", "--host", "codex"], {
    encoding: "utf8",
    env: {...process.env, CODEX_SESSION_ID: ""},
    input: JSON.stringify({cwd: project, tool_name: "Bash", tool_input: {command: "pwd", secret: "PRIVATE_TOOL_INPUT"}})
  });

  assert.equal(executed.status, 0, executed.stderr);
  const output = JSON.parse(executed.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "PreToolUse");
  assert.equal(output.permissionDecision, "allow");
  assert.match(output.permissionDecisionReason, /classification=diagnostic_read/);
  assert.match(output.permissionDecisionReason, /stage=session_identity/);
  assert.doesNotMatch(executed.stdout, /PRIVATE_TOOL_INPUT/);
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
  assert.equal(diagnostic.classification, "diagnostic_read");
  assert.equal(mutation.decision, "deny");
  assert.equal(mutation.classification, "mutation");
  assert.equal(unknown.decision, "deny");
  assert.equal(unknown.classification, "unknown");
  for (const result of [diagnostic, mutation, unknown]) {
    assert.equal(result.diagnostic.stage, "session_start");
    assert.equal(result.diagnostic.code, "invalid_session_state");
    assert.match(result.diagnostic.runtimePath, /\/(?:scripts|runtime)$/);
    assert.match(result.diagnostic.manifestPath, /\.leon-engineering-harness-runtime\.json$/);
    assert.match(result.diagnostic.recoveryCommand, /--verify/);
    assert.doesNotMatch(JSON.stringify(result), /broken-session|\{broken/);
  }
});

test("missing session identity still permits pwd but keeps writes fail-closed", t => {
  const project = makeProject(t);
  const diagnostic = handleHarnessHook({phase: "pre", input: {cwd: project, tool_name: "Bash", tool_input: {command: "pwd"}}});
  const mutation = handleHarnessHook({phase: "pre", input: {cwd: project, tool_name: "Write", tool_input: {file_path: "demo.txt"}}});

  assert.equal(diagnostic.decision, "allow");
  assert.equal(diagnostic.diagnostic.code, "missing_session_id");
  assert.equal(mutation.decision, "deny");
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);
});
