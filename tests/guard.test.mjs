import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import { decide } from "../scripts/guard.mjs";

const guardScript = path.resolve(import.meta.dirname, "..", "scripts", "guard.mjs");

function runGuard(input, {codex = true, raw} = {}) {
  const env = {...process.env};
  if (codex) {
    env.PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
    env.CLAUDE_PLUGIN_ROOT = env.PLUGIN_ROOT;
  } else {
    delete env.PLUGIN_ROOT;
  }
  return spawnSync(process.execPath, [guardScript], {
    encoding: "utf8",
    env,
    input: raw ?? JSON.stringify(input)
  });
}

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

test("Codex routine PreToolUse leaves native permissions untouched", () => {
  const run = runGuard({tool_name: "Bash", tool_input: {command: "git status --short"}});
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
});

test("Codex guard blocks deny and confirmation cases with supported protocol", () => {
  for (const [command, reason] of [
    [["rm", "-rf", "/tmp/synthetic-only"].join(" "), /destructive|secret|system/i],
    [["git", "push", "origin", "main"].join(" "), /confirmation|manual/i]
  ]) {
    const run = runGuard({tool_name: "Bash", tool_input: {command}});
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, "PreToolUse");
    assert.equal(output.permissionDecision, "deny");
    assert.match(output.permissionDecisionReason, reason);
    assert.equal(Object.hasOwn(output, "updatedInput"), false);
  }
});

test("Codex apply_patch input keeps secret-path and workflow confirmation guards", () => {
  for (const [target, expectedReason] of [
    ["/repo/.env.local", /secret|destructive/i],
    ["/repo/.github/workflows/ci.yml", /manual confirmation/i]
  ]) {
    const input = {tool_name: "apply_patch", tool_input: {command: `*** Begin Patch\n*** Update File: ${target}\n@@\n-old\n+new\n*** End Patch`}};
    const run = runGuard(input);
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout).hookSpecificOutput;
    assert.equal(output.permissionDecision, "deny");
    assert.match(output.permissionDecisionReason, expectedReason);
  }
});

test("Codex guard fails closed on missing fields and malformed JSON without echoing input", () => {
  for (const run of [
    runGuard({tool_input: {command: "git status --short"}}),
    runGuard({tool_name: "Bash", tool_input: {}}),
    runGuard({tool_name: "Edit", tool_input: {}}),
    runGuard({tool_name: "UnknownTool", tool_input: {command: "git status --short"}}),
    runGuard(null, {raw: "{PRIVATE_SENTINEL"})
  ]) {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.doesNotMatch(run.stdout + run.stderr, /PRIVATE_SENTINEL/);
  }
});

test("Claude plugin keeps its existing guard decisions", () => {
  for (const [command, expected] of [
    ["git status --short", "allow"],
    [["git", "push", "origin", "main"].join(" "), "ask"],
    [["rm", "-rf", "/tmp/synthetic-only"].join(" "), "deny"]
  ]) {
    const run = runGuard({tool_name: "Bash", tool_input: {command}}, {codex: false});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision, expected);
  }
});
