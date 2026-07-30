import test from "node:test";
import assert from "node:assert/strict";
import { toAuditEvent } from "../scripts/audit.mjs";

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
