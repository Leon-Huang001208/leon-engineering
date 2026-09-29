import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";
import test from "node:test";

import {
  assertCompleteChangedSet,
  discoverGitChangeSet,
} from "../lib/verification/changed-files.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8"}).trim();
}

function write(root, relative, content) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, content);
}

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-change-set-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test User"]);
  write(root, ".gitignore", "ignored.mjs\n");
  for (const relative of [
    "committed.mjs",
    "staged.mjs",
    "unstaged.mjs",
    "deleted.mjs",
    "old name.mjs",
    "unchanged.mjs",
  ]) write(root, relative, "base\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);

  write(root, "committed.mjs", "committed\n");
  git(root, ["add", "committed.mjs"]);
  git(root, ["commit", "-q", "-m", "committed change"]);

  write(root, "staged.mjs", "staged\n");
  git(root, ["add", "staged.mjs"]);
  write(root, "unstaged.mjs", "unstaged\n");
  fs.rmSync(path.join(root, "deleted.mjs"));
  git(root, ["mv", "old name.mjs", "new name.mjs"]);
  write(root, "新 文件.mjs", "untracked\n");
  write(root, "ignored.mjs", "ignored\n");
  return {root, base};
}

test("discovers committed staged unstaged untracked deleted and both rename paths", t => {
  const {root, base} = repository(t);
  const result = discoverGitChangeSet({projectRoot: root, base});
  assert.equal(result.baseCommit, base);
  assert.match(result.headCommit, /^[0-9a-f]{40}$/);
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.changedFiles, [
    "committed.mjs",
    "deleted.mjs",
    "new name.mjs",
    "old name.mjs",
    "staged.mjs",
    "unstaged.mjs",
    "新 文件.mjs",
  ]);
  assert.equal(result.changedFiles.includes("ignored.mjs"), false);
  assert.ok(result.entries.some(entry => entry.path === "old name.mjs" && entry.status === "renamed-from"));
  assert.ok(result.entries.some(entry =>
    entry.path === "new name.mjs" && entry.status === "renamed-to" && entry.previousPath === "old name.mjs"));
  assert.ok(result.entries.some(entry => entry.path === "deleted.mjs" && entry.status === "deleted"));
  assert.ok(result.entries.some(entry => entry.path === "新 文件.mjs" && entry.origin === "untracked"));
});

test("complete explicit paths are accepted but a subset cannot shrink required verification", t => {
  const {root, base} = repository(t);
  const discovered = discoverGitChangeSet({projectRoot: root, base});
  assert.deepEqual(
    assertCompleteChangedSet({discovered, explicitPaths: [...discovered.changedFiles].reverse()}),
    discovered.changedFiles,
  );
  assert.throws(
    () => assertCompleteChangedSet({discovered, explicitPaths: ["committed.mjs"]}),
    error => error.code === "INCOMPLETE_CHANGE_SET" && /does not match/.test(error.message),
  );
});

test("invalid baselines fail with a stable error and never fall back to an empty plan", t => {
  const {root} = repository(t);
  assert.throws(
    () => discoverGitChangeSet({projectRoot: root, base: "missing-ref"}),
    error => error.code === "BASELINE_ERROR" && /invalid Git baseline/.test(error.message),
  );
});

test("canonical CLI base mode emits a bound plan without executing policy values", t => {
  const {root, base} = repository(t);
  fs.mkdirSync(path.join(root, ".agents"), {recursive: true});
  fs.copyFileSync(
    path.join(REPOSITORY_ROOT, "tests", "fixtures", "verification", "rwb-v3", "verification-policy.json"),
    path.join(root, ".agents", "verification-policy.json"),
  );
  const result = spawnSync(process.execPath, [
    path.join(REPOSITORY_ROOT, "scripts", "verification-plan.mjs"),
    "--project", root,
    "--base", base,
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.schemaVersion, 3);
  assert.equal(plan.binding.source, "git");
  assert.equal(plan.binding.baseCommit, base);
  assert.equal(plan.changeSet.entries.length >= plan.changedFiles.length, true);
  assert.match(plan.binding.planSha256, /^[0-9a-f]{64}$/);
});
