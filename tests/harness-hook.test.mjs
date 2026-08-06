import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {handleHarnessHook} from "../scripts/harness-hook.mjs";

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

test("Claude post hook is non-blocking when it cannot identify a project", () => {
  assert.deepEqual(handleHarnessHook({
    phase: "post",
    input: {cwd: "/does/not/exist", session_id: "claude-session-01", tool_name: "Bash"}
  }), {decision: "allow", skipped: true});
});
