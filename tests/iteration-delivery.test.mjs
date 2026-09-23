import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupDelivery,
  prepareDelivery,
  publishDelivery,
  readDeliveryReceipt,
  refreshDeliveryStatus,
  rollbackDelivery,
  startDelivery
} from "../scripts/iteration-delivery.mjs";

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {encoding: "utf8"}).trim();
}

function commit(cwd, message) {
  git(cwd, ["add", "."]);
  git(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", message]);
}

function makeRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-iteration-delivery-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const remote = path.join(root, "origin.git");
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "--bare", remote]);
  execFileSync("git", ["init", project]);
  git(project, ["config", "user.name", "Test"]);
  git(project, ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(project, "README.md"), "# fixture\n");
  commit(project, "chore: seed fixture");
  git(project, ["branch", "-M", "main"]);
  git(project, ["remote", "add", "origin", remote]);
  git(project, ["push", "-u", "origin", "main"]);
  execFileSync("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  git(project, ["remote", "set-head", "origin", "-a"]);
  return {root, remote, project};
}

function receiptPath(project, taskId) {
  const commonDirectory = path.resolve(project, git(project, ["rev-parse", "--git-common-dir"]));
  return path.join(commonDirectory, "leon-engineering", "deliveries", `${taskId}.json`);
}

function assertReplacementRefusedWithoutStateChange(project, taskId, expected) {
  const file = receiptPath(project, taskId);
  const receiptBefore = fs.readFileSync(file, "utf8");
  const worktreesBefore = git(project, ["worktree", "list", "--porcelain"]);
  assert.throws(
    () => prepareDelivery({projectRoot: project, taskId, replacePrepared: true}),
    expected
  );
  assert.equal(fs.readFileSync(file, "utf8"), receiptBefore);
  assert.equal(git(project, ["worktree", "list", "--porcelain"]), worktreesBefore);
}

test("delivers a verified branch to the remote default branch and cleans every worktree", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-one", slug: "feature"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "delivered\n");
  commit(started.featureWorktree, "feat: add delivered file");

  const prepared = prepareDelivery({projectRoot: project, taskId: "task-one"});
  const published = publishDelivery({
    projectRoot: project,
    taskId: "task-one",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  assert.equal(published.mode, "direct");
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-one",
    resolveCiStatus: () => ({status: "not_configured", runs: []})
  });
  const cleaned = cleanupDelivery({projectRoot: project, taskId: "task-one"});

  assert.equal(cleaned.status, "cleaned");
  assert.equal(fs.existsSync(started.featureWorktree), false);
  assert.equal(fs.existsSync(prepared.integrationWorktree), false);
  assert.equal(git(project, ["show", "origin/main:feature.txt"]), "delivered");
  assert.throws(() => git(project, ["show-ref", "--verify", `refs/heads/${started.featureBranch}`]));
  assert.equal(readDeliveryReceipt({projectRoot: project, taskId: "task-one"}).cleanup.localBranchDeleted, true);
});

test("falls back to a pull request with a fake GitHub command runner when direct push is protected", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-pr", slug: "protected"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "via pr\n");
  commit(started.featureWorktree, "feat: add protected delivery");
  const prepared = prepareDelivery({projectRoot: project, taskId: "task-pr"});
  const githubCalls = [];
  const githubRunner = (command, args) => {
    githubCalls.push([command, ...args]);
    return {
      status: 0,
      stdout: args[1] === "create" ? "https://github.com/fixture/repo/pull/42\n" : "",
      stderr: ""
    };
  };
  const published = publishDelivery({
    projectRoot: project,
    taskId: "task-pr",
    verification: {command: "node --test", status: "passed", durationSeconds: 1},
    pushDefault: () => ({status: "protected"}),
    githubRunner,
    githubRepositoryName: "fixture/repo"
  });
  assert.equal(published.mode, "pr");
  assert.equal(published.pullRequest.number, 42);
  assert.deepEqual(githubCalls.map(call => call.slice(0, 3)), [
    ["gh", "pr", "create"],
    ["gh", "pr", "merge"]
  ]);

  git(project, ["push", "origin", `${prepared.integrationCommit}:refs/heads/main`]);
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-pr",
    resolveCiStatus: () => ({
      status: "passed",
      runs: [{conclusion: "SUCCESS"}],
      mergeCommit: prepared.integrationCommit
    })
  });
  const cleaned = cleanupDelivery({projectRoot: project, taskId: "task-pr"});
  assert.equal(cleaned.status, "cleaned");
  assert.equal(git(project, ["show", "origin/main:feature.txt"]), "via pr");
});

test("refuses cleanup while a managed worktree contains untracked files", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-dirty", slug: "dirty"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "delivered\n");
  commit(started.featureWorktree, "feat: add delivered file");
  prepareDelivery({projectRoot: project, taskId: "task-dirty"});
  publishDelivery({
    projectRoot: project,
    taskId: "task-dirty",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-dirty",
    resolveCiStatus: () => ({status: "passed", runs: [{conclusion: "success"}]})
  });
  fs.writeFileSync(path.join(started.featureWorktree, "untracked.txt"), "keep me\n");

  assert.throws(
    () => cleanupDelivery({projectRoot: project, taskId: "task-dirty"}),
    /feature worktree is dirty/
  );
  assert.equal(fs.existsSync(started.featureWorktree), true);
});

test("refuses publish when the remote default branch moved after integration", t => {
  const {root, remote, project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-race", slug: "race"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "candidate\n");
  commit(started.featureWorktree, "feat: add candidate");
  prepareDelivery({projectRoot: project, taskId: "task-race"});

  const concurrent = path.join(root, "concurrent");
  execFileSync("git", ["clone", remote, concurrent]);
  fs.writeFileSync(path.join(concurrent, "concurrent.txt"), "new base\n");
  commit(concurrent, "feat: advance default branch");
  git(concurrent, ["push", "origin", "main"]);

  assert.throws(
    () => publishDelivery({
      projectRoot: project,
      taskId: "task-race",
      verification: {command: "node --test", status: "passed", durationSeconds: 1}
    }),
    /remote default branch moved/
  );

  const rebuilt = prepareDelivery({projectRoot: project, taskId: "task-race"});
  assert.equal(rebuilt.integrationHistory.length, 1);
  assert.equal(fs.existsSync(rebuilt.integrationHistory[0].worktree), false);
  assert.equal(git(rebuilt.integrationWorktree, ["show", "HEAD:feature.txt"]), "candidate");
  assert.equal(git(rebuilt.integrationWorktree, ["show", "HEAD:concurrent.txt"]), "new base");
  publishDelivery({
    projectRoot: project,
    taskId: "task-race",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-race",
    resolveCiStatus: () => ({status: "passed", runs: [{conclusion: "success"}]})
  });
  cleanupDelivery({projectRoot: project, taskId: "task-race"});
  assert.equal(readDeliveryReceipt({projectRoot: project, taskId: "task-race"}).status, "cleaned");
});

test("rebuilds integration for new feature commits after a completed delivery", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-follow-up", slug: "follow-up"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "first\n");
  commit(started.featureWorktree, "feat: first delivery");

  const prepared = prepareDelivery({projectRoot: project, taskId: "task-follow-up"});
  publishDelivery({
    projectRoot: project,
    taskId: "task-follow-up",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-follow-up",
    resolveCiStatus: () => ({status: "not_configured", runs: []})
  });
  fs.writeFileSync(path.join(started.featureWorktree, "follow-up.txt"), "second\n");
  commit(started.featureWorktree, "fix: follow-up delivery");

  const rebuilt = prepareDelivery({projectRoot: project, taskId: "task-follow-up"});
  assert.equal(rebuilt.status, "prepared");
  assert.equal(rebuilt.integrationHistory.length, 1);
  assert.equal(rebuilt.integrationHistory[0].commit, prepared.integrationCommit);
  assert.equal(fs.existsSync(prepared.integrationWorktree), false);
  assert.equal(git(rebuilt.integrationWorktree, ["show", "HEAD:feature.txt"]), "first");
  assert.equal(git(rebuilt.integrationWorktree, ["show", "HEAD:follow-up.txt"]), "second");
});

test("replaces an unshipped prepared revision after a review fix", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-replace", slug: "replace"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "first\n");
  commit(started.featureWorktree, "feat: first candidate");
  const prepared = prepareDelivery({projectRoot: project, taskId: "task-replace"});
  fs.writeFileSync(path.join(started.featureWorktree, "review-fix.txt"), "reviewed\n");
  commit(started.featureWorktree, "fix: address review");

  const replaced = prepareDelivery({
    projectRoot: project,
    taskId: "task-replace",
    replacePrepared: true
  });

  assert.equal(replaced.status, "prepared");
  assert.equal(replaced.baseCommit, prepared.baseCommit);
  assert.equal(replaced.integrationHistory.length, 1);
  assert.deepEqual(replaced.integrationHistory[0], {
    branch: prepared.integrationBranch,
    worktree: prepared.integrationWorktree,
    commit: prepared.integrationCommit,
    worktreeRemoved: true,
    status: "superseded"
  });
  assert.equal(fs.existsSync(prepared.integrationWorktree), false);
  assert.match(replaced.integrationBranch, /-r1$/);
  assert.equal(git(replaced.integrationWorktree, ["show", "HEAD:review-fix.txt"]), "reviewed");
});

test("prepared replacement fails closed when any safety condition is unmet", async t => {
  async function preparedFixture(name) {
    const fixture = makeRepository(t);
    const started = startDelivery({projectRoot: fixture.project, taskId: name, slug: name});
    fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "first\n");
    commit(started.featureWorktree, "feat: candidate");
    const prepared = prepareDelivery({projectRoot: fixture.project, taskId: name});
    return {...fixture, started, prepared};
  }

  await t.test("dirty integration worktree", async () => {
    const {project, started, prepared} = await preparedFixture("replace-dirty");
    fs.writeFileSync(path.join(started.featureWorktree, "review.txt"), "new\n");
    commit(started.featureWorktree, "fix: review");
    fs.writeFileSync(path.join(prepared.integrationWorktree, "untracked.txt"), "dirty\n");
    assertReplacementRefusedWithoutStateChange(project, "replace-dirty", /integration worktree is dirty/);
  });

  await t.test("unchanged feature head", async () => {
    const {project} = await preparedFixture("replace-unchanged");
    assertReplacementRefusedWithoutStateChange(project, "replace-unchanged", /no new feature commits/);
  });

  await t.test("moved remote default", async () => {
    const {root, remote, project, started} = await preparedFixture("replace-remote");
    fs.writeFileSync(path.join(started.featureWorktree, "review.txt"), "new\n");
    commit(started.featureWorktree, "fix: review");
    const concurrent = path.join(root, "replace-concurrent");
    execFileSync("git", ["clone", remote, concurrent]);
    fs.writeFileSync(path.join(concurrent, "remote.txt"), "moved\n");
    commit(concurrent, "feat: move remote");
    git(concurrent, ["push", "origin", "main"]);
    assertReplacementRefusedWithoutStateChange(project, "replace-remote", /remote default branch moved/);
  });

  await t.test("prepared commit already published", async () => {
    const {project, started, prepared} = await preparedFixture("replace-published");
    fs.writeFileSync(path.join(started.featureWorktree, "review.txt"), "new\n");
    commit(started.featureWorktree, "fix: review");
    git(project, ["push", "origin", `${prepared.integrationCommit}:refs/heads/main`]);
    assertReplacementRefusedWithoutStateChange(project, "replace-published", /remote default branch moved|already contained/);
  });

  await t.test("recorded CI run", async () => {
    const {project, started} = await preparedFixture("replace-ci");
    fs.writeFileSync(path.join(started.featureWorktree, "review.txt"), "new\n");
    commit(started.featureWorktree, "fix: review");
    const file = receiptPath(project, "replace-ci");
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    receipt.ci.runs = [{id: 42, status: "queued"}];
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
    assertReplacementRefusedWithoutStateChange(project, "replace-ci", /CI run/);
  });

  await t.test("recorded pull request", async () => {
    const {project, started} = await preparedFixture("replace-pr");
    fs.writeFileSync(path.join(started.featureWorktree, "review.txt"), "new\n");
    commit(started.featureWorktree, "fix: review");
    const file = receiptPath(project, "replace-pr");
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    receipt.pullRequest = {number: 42, url: "https://example.invalid/pull/42"};
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
    assertReplacementRefusedWithoutStateChange(project, "replace-pr", /pull request/);
  });
});

test("CLI accepts replace-prepared only with prepare", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "replace-cli", slug: "replace-cli"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "first\n");
  commit(started.featureWorktree, "feat: candidate");
  prepareDelivery({projectRoot: project, taskId: "replace-cli"});
  fs.writeFileSync(path.join(started.featureWorktree, "review.txt"), "fixed\n");
  commit(started.featureWorktree, "fix: review");
  const script = path.resolve(import.meta.dirname, "..", "scripts", "iteration-delivery.mjs");

  const replaced = spawnSync(process.execPath, [
    script, "--prepare", "--replace-prepared", "--project", project, "--task-id", "replace-cli"
  ], {encoding: "utf8"});
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(JSON.parse(replaced.stdout).integrationHistory[0].status, "superseded");

  const rejected = spawnSync(process.execPath, [
    script, "--status", "--replace-prepared", "--project", project, "--task-id", "replace-cli"
  ], {encoding: "utf8"});
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /--replace-prepared requires --prepare/);
});

test("rejects a completed delivery without new feature commits", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-no-follow-up", slug: "no-follow-up"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "first\n");
  commit(started.featureWorktree, "feat: only delivery");

  prepareDelivery({projectRoot: project, taskId: "task-no-follow-up"});
  publishDelivery({
    projectRoot: project,
    taskId: "task-no-follow-up",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-no-follow-up",
    resolveCiStatus: () => ({status: "not_configured", runs: []})
  });

  assert.throws(
    () => prepareDelivery({projectRoot: project, taskId: "task-no-follow-up"}),
    /completed delivery has no new feature commits/
  );
});

test("preserves a conflicted integration worktree and resumes after the merge is committed", t => {
  const {root, remote, project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-conflict", slug: "conflict"});
  fs.writeFileSync(path.join(started.featureWorktree, "README.md"), "feature\n");
  commit(started.featureWorktree, "feat: change readme");

  const concurrent = path.join(root, "conflict-concurrent");
  execFileSync("git", ["clone", remote, concurrent]);
  fs.writeFileSync(path.join(concurrent, "README.md"), "default\n");
  commit(concurrent, "feat: change readme on default");
  git(concurrent, ["push", "origin", "main"]);

  assert.throws(
    () => prepareDelivery({projectRoot: project, taskId: "task-conflict"}),
    /integration merge has conflicts/
  );
  const conflicted = readDeliveryReceipt({projectRoot: project, taskId: "task-conflict"});
  assert.equal(conflicted.status, "integration_conflict");
  fs.writeFileSync(path.join(conflicted.integrationWorktree, "README.md"), "default and feature\n");
  commit(conflicted.integrationWorktree, "merge: resolve readme conflict");

  const resumed = prepareDelivery({projectRoot: project, taskId: "task-conflict"});
  assert.equal(resumed.status, "prepared");
  assert.equal(git(resumed.integrationWorktree, ["show", "HEAD:README.md"]), "default and feature");
});

test("limits CI repair pushes to three and permits a verified rollback only at the owned remote tip", t => {
  const {project} = makeRepository(t);
  const started = startDelivery({projectRoot: project, taskId: "task-rollback", slug: "rollback"});
  fs.writeFileSync(path.join(started.featureWorktree, "feature.txt"), "candidate\n");
  commit(started.featureWorktree, "feat: add candidate");
  const prepared = prepareDelivery({projectRoot: project, taskId: "task-rollback"});
  publishDelivery({
    projectRoot: project,
    taskId: "task-rollback",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  refreshDeliveryStatus({
    projectRoot: project,
    taskId: "task-rollback",
    resolveCiStatus: () => ({status: "failed", runs: [{conclusion: "failure"}]})
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    fs.writeFileSync(path.join(prepared.integrationWorktree, `repair-${attempt}.txt`), `${attempt}\n`);
    commit(prepared.integrationWorktree, `fix: repair CI ${attempt}`);
    publishDelivery({
      projectRoot: project,
      taskId: "task-rollback",
      repair: true,
      verification: {command: "node --test", status: "passed", durationSeconds: 1}
    });
    refreshDeliveryStatus({
      projectRoot: project,
      taskId: "task-rollback",
      resolveCiStatus: () => ({status: "failed", runs: [{conclusion: "failure"}]})
    });
  }
  assert.throws(
    () => publishDelivery({
      projectRoot: project,
      taskId: "task-rollback",
      repair: true,
      verification: {command: "node --test", status: "passed", durationSeconds: 1}
    }),
    /maximum CI repair attempts reached/
  );

  const rolledBack = rollbackDelivery({
    projectRoot: project,
    taskId: "task-rollback",
    verification: {command: "node --test", status: "passed", durationSeconds: 1}
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.throws(() => git(project, ["show", "origin/main:feature.txt"]));
});
