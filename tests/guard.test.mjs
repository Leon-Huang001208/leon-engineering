import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/guard.mjs";

test("denies destructive and credential actions", () => {
  assert.equal(decide({tool_name: "Bash", tool_input: {command: "rm -rf /tmp/demo"}}).decision, "deny");
  assert.equal(decide({tool_name: "Bash", tool_input: {command: "git reset --hard HEAD~1"}}).decision, "deny");
  assert.equal(decide({tool_name: "Edit", tool_input: {file_path: "/repo/.env"}}).decision, "deny");
  assert.equal(decide({tool_name: "Write", tool_input: {file_path: "/repo/.env.local"}}).decision, "deny");
});

test("asks before remote and dependency changes", () => {
  assert.equal(decide({tool_name: "Bash", tool_input: {command: "git push origin main"}}).decision, "ask");
  assert.equal(decide({tool_name: "Bash", tool_input: {command: "python -m pip install httpx"}}).decision, "ask");
  assert.equal(decide({tool_name: "Edit", tool_input: {file_path: "/repo/.github/workflows/ci.yml"}}).decision, "ask");
});

test("allows normal local engineering", () => {
  assert.equal(decide({tool_name: "Bash", tool_input: {command: "git status --short"}}).decision, "allow");
  assert.equal(decide({tool_name: "Bash", tool_input: {command: "python -m pytest tests/unit -q"}}).decision, "allow");
  assert.equal(decide({tool_name: "Write", tool_input: {file_path: "/repo/src/example.py"}}).decision, "allow");
});
