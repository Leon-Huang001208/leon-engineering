import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveHarnessStorage,
  previewHarnessMigration,
  migrateHarnessStorage,
  verifyHarnessMigration
} from "../scripts/harness-storage.mjs";
import {recordOutcome, readHarnessTask, startHarnessSession} from "../scripts/harness-project.mjs";
import {evaluateHarness} from "../scripts/harness-evaluate.mjs";
import {enforceHarnessTask} from "../scripts/harness-enforce.mjs";
import {runObserved} from "../scripts/harness-execution.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function makeGitFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-storage-"));
  const repository = path.join(root, "repository");
  const worktree = path.join(root, "linked");
  fs.mkdirSync(repository);
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["config", "user.email", "test@example.invalid"]);
  fs.writeFileSync(path.join(repository, "AGENTS.md"), "# fixture\n");
  fs.writeFileSync(path.join(repository, "package.json"), JSON.stringify({scripts: {test: "node verifier.mjs"}}));
  fs.writeFileSync(path.join(repository, "verifier.mjs"), "process.stdout.write('verified\\n');\n");
  git(repository, ["add", "AGENTS.md", "package.json", "verifier.mjs"]);
  git(repository, ["commit", "-qm", "fixture"]);
  git(repository, ["worktree", "add", "-q", "-b", "linked", worktree]);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, repository, worktree};
}

test("resolves one Git-common Harness directory for main and linked worktrees", t => {
  const {repository, worktree} = makeGitFixture(t);

  const mainStorage = resolveHarnessStorage({projectRoot: repository});
  const linkedStorage = resolveHarnessStorage({projectRoot: worktree});

  assert.equal(mainStorage.kind, "git-common");
  assert.equal(linkedStorage.kind, "git-common");
  assert.equal(mainStorage.projectRoot, fs.realpathSync(repository));
  assert.equal(linkedStorage.projectRoot, fs.realpathSync(repository));
  assert.equal(mainStorage.workspaceRoot, fs.realpathSync(repository));
  assert.equal(linkedStorage.workspaceRoot, fs.realpathSync(worktree));
  assert.equal(mainStorage.directory, linkedStorage.directory);
  assert.equal(
    mainStorage.directory,
    path.join(mainStorage.commonDirectory, "leon-engineering", "harness")
  );
  assert.equal(fs.existsSync(mainStorage.directory), false);
});

test("keeps non-Git Harness storage project-local", t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-project-local-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));

  const storage = resolveHarnessStorage({projectRoot: project});

  assert.equal(storage.kind, "project-local");
  assert.equal(storage.directory, path.join(fs.realpathSync(project), ".ai", "harness"));
  assert.equal(storage.legacyDirectory, storage.directory);
  assert.equal(fs.existsSync(storage.directory), false);
});

function writeLegacyHarness(repository, entries = {}) {
  const legacy = path.join(fs.realpathSync(repository), ".ai", "harness");
  fs.mkdirSync(path.join(legacy, "tasks"), {recursive: true});
  const defaults = {
    "agent-map.md": "# Agent Map\n",
    "tasks/task-one.json": '{"id":"task-one"}\n',
    "metrics.jsonl": ""
  };
  for (const [relative, content] of Object.entries({...defaults, ...entries})) {
    const destination = path.join(legacy, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, content);
  }
  return legacy;
}

test("migration preview is read-only and reports hashes and sizes", t => {
  const {repository} = makeGitFixture(t);
  const legacy = writeLegacyHarness(repository);
  const storage = resolveHarnessStorage({projectRoot: repository});

  const preview = previewHarnessMigration({projectRoot: repository});

  assert.equal(preview.needed, true);
  assert.equal(preview.source, legacy);
  assert.equal(preview.destination, storage.directory);
  assert.equal(preview.files.length, 3);
  assert.ok(preview.bytes > 0);
  assert.match(preview.treeHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(preview.conflicts, []);
  assert.equal(fs.existsSync(storage.directory), false);
});

test("migration copies and verifies records while preserving the legacy Harness", t => {
  const {repository} = makeGitFixture(t);
  const legacy = writeLegacyHarness(repository);
  const storage = resolveHarnessStorage({projectRoot: repository});

  const result = migrateHarnessStorage({projectRoot: repository});

  assert.equal(result.migrated, true);
  assert.equal(fs.existsSync(legacy), true);
  assert.equal(fs.readFileSync(path.join(storage.directory, "tasks", "task-one.json"), "utf8"), '{"id":"task-one"}\n');
  assert.equal(result.manifest.schemaVersion, 1);
  assert.equal(result.manifest.source, legacy);
  assert.equal(result.manifest.destination, storage.directory);
  assert.equal(result.manifest.fileCount, 3);
  assert.equal(result.manifest.files.length, 3);
  assert.match(result.manifest.treeHash, /^[0-9a-f]{64}$/);
  assert.match(result.manifest.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(result.rollback, {
    action: "remove_verified_destination",
    source: legacy,
    destination: storage.directory
  });
  assert.equal(fs.statSync(storage.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(storage.directory, "migration-manifest.json")).mode & 0o777, 0o600);
});

test("migration refuses symlinks, unreadable records, and conflicting destination tasks", async t => {
  await t.test("symlink", () => {
    const {repository} = makeGitFixture(t);
    const legacy = writeLegacyHarness(repository);
    fs.symlinkSync(path.join(legacy, "agent-map.md"), path.join(legacy, "linked-map"));

    const preview = previewHarnessMigration({projectRoot: repository});
    assert.deepEqual(preview.conflicts, ["symlink:linked-map"]);
    assert.throws(() => migrateHarnessStorage({projectRoot: repository}), /unsafe legacy Harness entries/);
  });

  await t.test("unreadable", () => {
    const {repository} = makeGitFixture(t);
    const legacy = writeLegacyHarness(repository);
    const unreadable = path.join(legacy, "tasks", "task-one.json");
    fs.chmodSync(unreadable, 0o000);
    t.after(() => {
      if (fs.existsSync(unreadable)) fs.chmodSync(unreadable, 0o600);
    });

    const preview = previewHarnessMigration({projectRoot: repository});
    assert.deepEqual(preview.conflicts, ["unreadable:tasks/task-one.json"]);
    assert.throws(() => migrateHarnessStorage({projectRoot: repository}), /unsafe legacy Harness entries/);
  });

  await t.test("conflicting task", () => {
    const {repository} = makeGitFixture(t);
    const legacy = writeLegacyHarness(repository);
    const storage = resolveHarnessStorage({projectRoot: repository});
    fs.mkdirSync(path.join(storage.directory, "tasks"), {recursive: true});
    fs.writeFileSync(path.join(storage.directory, "tasks", "task-one.json"), '{"id":"different"}\n');

    const preview = previewHarnessMigration({projectRoot: repository});
    assert.deepEqual(preview.conflicts, ["different:tasks/task-one.json"]);
    assert.throws(() => migrateHarnessStorage({projectRoot: repository}), /migration conflicts/);
    assert.equal(fs.existsSync(legacy), true);
    assert.equal(fs.readFileSync(path.join(storage.directory, "tasks", "task-one.json"), "utf8"), '{"id":"different"}\n');
  });
});

test("Harness lifecycle and registered verifier survive normal linked-worktree removal", async t => {
  const {repository, worktree} = makeGitFixture(t);
  startHarnessSession({
    projectRoot: worktree,
    host: "codex",
    sessionId: "linked-session",
    newTask: true,
    task: {
      id: "linked-task",
      goal: "Persist outside the disposable worktree.",
      acceptanceCriteria: ["The main checkout can enforce the result."]
    }
  });
  git(repository, ["worktree", "remove", worktree]);

  const storage = resolveHarnessStorage({projectRoot: repository});
  const verifierManifest = JSON.parse(fs.readFileSync(path.join(storage.directory, "verifiers.json"), "utf8"));
  const observed = await runObserved({
    projectRoot: repository,
    taskId: "linked-task",
    verifierId: verifierManifest.verifiers[0].id
  });
  assert.equal(observed.status, "passed");

  recordOutcome({
    projectRoot: repository,
    taskId: "linked-task",
    host: "codex",
    outcome: {
      status: "completed",
      clarificationRounds: 0,
      reworkCount: 0,
      verificationCommand: "node --test",
      verificationStatus: "passed",
      verificationDurationSeconds: 1
    }
  });

  assert.equal(readHarnessTask({projectRoot: repository, taskId: "linked-task"}).status, "completed");
  assert.equal(evaluateHarness({projectRoot: repository, taskId: "linked-task"}).summary.completedPassedCount, 1);
  assert.deepEqual(enforceHarnessTask({projectRoot: repository, taskId: "linked-task"}), {
    taskId: "linked-task",
    verificationStatus: "passed",
    verificationDurationSeconds: 1
  });
});

test("migration CLI previews before explicit apply", t => {
  const {repository} = makeGitFixture(t);
  writeLegacyHarness(repository);
  const script = path.join(sourceRoot, "scripts", "harness-storage.mjs");
  const storage = resolveHarnessStorage({projectRoot: repository});

  const preview = spawnSync(process.execPath, [script, "--preview", "--project", repository], {encoding: "utf8"});
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).needed, true);
  assert.equal(fs.existsSync(storage.directory), false);

  const migrated = spawnSync(process.execPath, [script, "--migrate", "--project", repository], {encoding: "utf8"});
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.equal(JSON.parse(migrated.stdout).migrated, true);
  assert.equal(fs.existsSync(path.join(storage.directory, "migration-manifest.json")), true);
});

test("runtime accepts only a verified dual-state migration", t => {
  const {repository} = makeGitFixture(t);
  const legacy = writeLegacyHarness(repository);
  const storage = resolveHarnessStorage({projectRoot: repository});
  fs.mkdirSync(path.join(storage.directory, "tasks"), {recursive: true});
  fs.writeFileSync(path.join(storage.directory, "agent-map.md"), "# divergent\n");
  fs.writeFileSync(path.join(storage.directory, "metrics.jsonl"), "");
  fs.writeFileSync(path.join(storage.directory, "tasks", "task-one.json"), '{"id":"different"}\n');

  assert.equal(verifyHarnessMigration({projectRoot: repository}).valid, false);
  assert.throws(() => startHarnessSession({
    projectRoot: repository,
    host: "codex",
    sessionId: "dual-state",
    newTask: true,
    task: {id: "new-task", goal: "Do not split state.", acceptanceCriteria: ["One ledger remains."]}
  }), /legacy Harness migration required/);

  fs.rmSync(storage.directory, {recursive: true});
  migrateHarnessStorage({projectRoot: repository});
  assert.deepEqual(verifyHarnessMigration({projectRoot: repository}), {valid: true, drift: []});
  assert.equal(startHarnessSession({
    projectRoot: repository,
    host: "codex",
    sessionId: "verified-migration",
    newTask: true,
    task: {id: "new-task", goal: "Use the verified destination.", acceptanceCriteria: ["The task starts."]}
  }).taskId, "new-task");

  fs.appendFileSync(path.join(legacy, "agent-map.md"), "changed\n");
  assert.equal(verifyHarnessMigration({projectRoot: repository}).valid, false);
  assert.throws(() => readHarnessTask({projectRoot: repository, taskId: "new-task"}), /legacy Harness migration required/);
});
