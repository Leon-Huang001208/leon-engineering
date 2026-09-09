import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

function makeProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-session-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
  return project;
}

const sourceRoot = path.resolve(import.meta.dirname, "..");

test("session CLI starts a project task automatically and resumes it by opaque session id", t => {
  const project = makeProject(t);
  const script = path.join(sourceRoot, "scripts", "harness-session.mjs");
  const options = [
    script, "--start", "--project", project, "--host", "codex", "--session-id", "thread-01",
    "--task-id", "automatic-cli", "--goal", "隐私目标", "--acceptance", "只记录事实", "--delivery-required"
  ];

  const started = spawnSync(process.execPath, options, {encoding: "utf8"});
  assert.equal(started.status, 0, started.stderr);
  assert.deepEqual(JSON.parse(started.stdout).session, {
    taskId: "automatic-cli",
    resumed: false,
    host: "codex"
  });

  const resumed = spawnSync(process.execPath, options, {encoding: "utf8"});
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).session.resumed, true);
  const task = JSON.parse(fs.readFileSync(path.join(project, ".ai", "harness", "tasks", "automatic-cli.json"), "utf8"));
  assert.deepEqual(task.delivery, {required: true});
  const events = fs.readFileSync(path.join(project, ".ai", "harness", "events.jsonl"), "utf8");
  assert.doesNotMatch(events, /隐私目标|只记录事实|thread-01/);
});

test("session CLI help does not require a project", () => {
  const script = path.join(sourceRoot, "scripts", "harness-session.mjs");
  const result = spawnSync(process.execPath, [script, "--help"], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /自动创建或恢复/);
  assert.match(result.stdout, /--host claude\|codex/);
});
