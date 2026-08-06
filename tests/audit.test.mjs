import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {forwardAuditToHarness, toAuditEvent} from "../scripts/audit.mjs";

test("records no command, path, source, or token", () => {
  const event = toAuditEvent({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: {command: "git status --token secret-value", file_path: "/repo/.env"}
  });

  assert.deepEqual(Object.keys(event).sort(), ["event", "timestamp", "tool"]);
  assert.equal(event.event, "PostToolUse");
  assert.equal(event.tool, "Bash");
  assert.doesNotMatch(JSON.stringify(event), /secret|status|\.env/i);
});

test("forwards legacy post-hook input to the project Harness instead of a user-global log", t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-audit-forward-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");

  const result = forwardAuditToHarness({
    cwd: project,
    session_id: "audit-session",
    tool_name: "Bash",
    tool_input: {command: "echo secret-value"}
  });

  assert.equal(result.decision, "allow");
  const events = fs.readFileSync(path.join(project, ".ai", "harness", "events.jsonl"), "utf8");
  assert.match(events, /tool_completed/);
  assert.doesNotMatch(events, /secret-value/);
});
