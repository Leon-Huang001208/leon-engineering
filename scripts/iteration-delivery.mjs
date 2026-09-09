import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const CI_STATUSES = new Set(["pending", "passed", "failed", "not_configured"]);
const MAX_REPAIR_ATTEMPTS = 3;

class CommandError extends Error {
  constructor(message, result) {
    super(message);
    this.result = result;
  }
}

function run(command, args, {cwd, allowFailure = false, env} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ? {...process.env, ...env} : process.env
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || "command failed").trim();
    throw new CommandError(`${command} failed: ${detail}`, result);
  }
  return result;
}

function git(cwd, args, options = {}) {
  return run("git", ["-C", cwd, ...args], {cwd, ...options});
}

function output(result) {
  return result.stdout.trim();
}

function assertTaskId(taskId) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) throw new Error("invalid task id");
  return taskId;
}

function assertSlug(slug) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) throw new Error("invalid branch slug");
  return slug;
}

function resolveRepository(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.trim().length === 0) throw new Error("project root is required");
  const candidate = path.resolve(projectRoot);
  const rootResult = git(candidate, ["rev-parse", "--show-toplevel"], {allowFailure: true});
  if (rootResult.status !== 0) throw new Error("project is not a Git repository");
  const repositoryRoot = path.resolve(output(rootResult));
  const common = output(git(repositoryRoot, ["rev-parse", "--git-common-dir"]));
  const commonDirectory = path.resolve(repositoryRoot, common);
  const stat = fs.lstatSync(commonDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid Git common directory");
  return {repositoryRoot, commonDirectory};
}

function stateDirectory(repository) {
  return path.join(repository.commonDirectory, "leon-engineering");
}

function receiptFile(repository, taskId) {
  return path.join(stateDirectory(repository), "deliveries", `${assertTaskId(taskId)}.json`);
}

function logFile(repository) {
  return path.join(stateDirectory(repository), "logs", "iteration-delivery.jsonl");
}

function ensurePrivateDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid delivery state directory");
    return;
  }
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
}

function writeAtomically(destination, value) {
  ensurePrivateDirectory(path.dirname(destination));
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function appendLog(repository, taskId, event, details = {}) {
  const destination = logFile(repository);
  ensurePrivateDirectory(path.dirname(destination));
  const record = {timestamp: new Date().toISOString(), taskId, event, ...details};
  fs.appendFileSync(destination, `${JSON.stringify(record)}\n`, {mode: 0o600});
}

function readJsonFile(destination, missingMessage) {
  if (!fs.existsSync(destination)) throw new Error(missingMessage);
  const stat = fs.lstatSync(destination);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("invalid delivery receipt");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(destination, "utf8"));
  } catch {
    throw new Error("invalid delivery receipt");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) {
    throw new Error("invalid delivery receipt");
  }
  return value;
}

export function readDeliveryReceipt({projectRoot, taskId}) {
  const repository = resolveRepository(projectRoot);
  const receipt = readJsonFile(receiptFile(repository, taskId), `missing delivery receipt: ${taskId}`);
  if (receipt.taskId !== taskId || receipt.repositoryRoot !== repository.repositoryRoot) {
    throw new Error("delivery receipt repository mismatch");
  }
  return receipt;
}

function saveReceipt(repository, receipt) {
  receipt.updatedAt = new Date().toISOString();
  writeAtomically(receiptFile(repository, receipt.taskId), receipt);
  return receipt;
}

function remoteUrl(repositoryRoot, remote) {
  const result = git(repositoryRoot, ["remote", "get-url", remote], {allowFailure: true});
  if (result.status !== 0 || output(result).length === 0) throw new Error(`missing Git remote: ${remote}`);
  return output(result);
}

function resolveDefaultBranch(repositoryRoot, remote) {
  remoteUrl(repositoryRoot, remote);
  const result = git(repositoryRoot, ["ls-remote", "--symref", remote, "HEAD"]);
  const match = result.stdout.match(/^ref:\s+refs\/heads\/([^\t\n]+)\s+HEAD$/m);
  if (!match) throw new Error(`cannot resolve default branch for remote: ${remote}`);
  return match[1];
}

function fetchBranch(repositoryRoot, remote, branch) {
  git(repositoryRoot, ["fetch", "--prune", remote, `refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  return output(git(repositoryRoot, ["rev-parse", `refs/remotes/${remote}/${branch}`]));
}

function remoteBranchCommit(repositoryRoot, remote, branch) {
  const result = git(repositoryRoot, ["ls-remote", remote, `refs/heads/${branch}`]);
  const line = result.stdout.trim();
  return line ? line.split(/\s+/)[0] : null;
}

function localBranchExists(repositoryRoot, branch) {
  return git(repositoryRoot, ["show-ref", "--verify", `refs/heads/${branch}`], {allowFailure: true}).status === 0;
}

function managedWorktreeRoot(repositoryRoot) {
  return path.join(path.dirname(repositoryRoot), `${path.basename(repositoryRoot)}-worktrees`);
}

function ensureUnusedPath(destination) {
  if (fs.existsSync(destination)) throw new Error(`worktree path already exists: ${destination}`);
  ensurePrivateDirectory(path.dirname(destination));
}

function assertCleanWorktree(worktree, label) {
  if (!fs.existsSync(worktree)) throw new Error(`${label} is missing`);
  const status = output(git(worktree, ["status", "--porcelain", "--untracked-files=all"]));
  if (status) throw new Error(`${label} is dirty`);
}

function verificationRecord(verification) {
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    throw new Error("verification evidence is required");
  }
  if (typeof verification.command !== "string" || verification.command.trim().length === 0) {
    throw new Error("verification command is required");
  }
  if (verification.status !== "passed") throw new Error("merged result verification must be passed");
  if (!Number.isInteger(verification.durationSeconds) || verification.durationSeconds < 0) {
    throw new Error("verification duration seconds is required");
  }
  return {
    command: verification.command.trim(),
    status: verification.status,
    durationSeconds: verification.durationSeconds,
    recordedAt: new Date().toISOString()
  };
}

function lockFile(repository, taskId) {
  return path.join(stateDirectory(repository), "locks", `${taskId}.lock`);
}

function withTaskLock(repository, taskId, callback) {
  const destination = lockFile(repository, taskId);
  ensurePrivateDirectory(path.dirname(destination));
  let descriptor;
  try {
    descriptor = fs.openSync(destination, "wx", 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`delivery task is locked: ${taskId}`);
    throw error;
  }
  try {
    return callback();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(destination, {force: true});
  }
}

export function startDelivery({projectRoot, taskId, slug, remote = "origin", worktreeRoot}) {
  assertTaskId(taskId);
  assertSlug(slug);
  const repository = resolveRepository(projectRoot);
  const destination = receiptFile(repository, taskId);
  if (fs.existsSync(destination)) throw new Error(`delivery receipt already exists: ${taskId}`);
  const defaultBranch = resolveDefaultBranch(repository.repositoryRoot, remote);
  const baseCommit = fetchBranch(repository.repositoryRoot, remote, defaultBranch);
  const featureBranch = `codex/${taskId}-${slug}`;
  if (localBranchExists(repository.repositoryRoot, featureBranch)) throw new Error(`feature branch already exists: ${featureBranch}`);
  const root = worktreeRoot ? path.resolve(worktreeRoot) : managedWorktreeRoot(repository.repositoryRoot);
  const featureWorktree = path.join(root, taskId);
  ensureUnusedPath(featureWorktree);
  git(repository.repositoryRoot, ["worktree", "add", "-b", featureBranch, featureWorktree, `refs/remotes/${remote}/${defaultBranch}`]);
  const now = new Date().toISOString();
  const receipt = {
    schemaVersion: 1,
    taskId,
    repositoryRoot: repository.repositoryRoot,
    remote,
    remoteUrl: remoteUrl(repository.repositoryRoot, remote),
    defaultBranch,
    baseCommit,
    featureBranch,
    featureWorktree,
    featureCommit: baseCommit,
    integrationBranch: null,
    integrationWorktree: null,
    integrationCommit: null,
    integrationHistory: [],
    remoteCommit: null,
    mode: null,
    pullRequest: null,
    verification: {status: "not_run"},
    ci: {status: "pending", runs: []},
    repairAttempts: 0,
    rollback: {status: "not_run"},
    cleanup: {
      featureWorktreeRemoved: false,
      integrationWorktreeRemoved: false,
      localBranchDeleted: false,
      remoteBranchDeleted: false
    },
    status: "started",
    createdAt: now,
    updatedAt: now
  };
  saveReceipt(repository, receipt);
  appendLog(repository, taskId, "started", {defaultBranch, featureBranch});
  return receipt;
}

export function prepareDelivery({projectRoot, taskId, integrationWorktreeRoot}) {
  const repository = resolveRepository(projectRoot);
  assertTaskId(taskId);
  return withTaskLock(repository, "integration", () => {
    const receipt = readDeliveryReceipt({projectRoot: repository.repositoryRoot, taskId});
    if (receipt.status === "integration_conflict") {
      const unresolved = output(git(receipt.integrationWorktree, ["diff", "--name-only", "--diff-filter=U"]));
      if (unresolved) throw new Error("integration merge still has unresolved conflicts");
      assertCleanWorktree(receipt.integrationWorktree, "integration worktree");
      if (git(receipt.integrationWorktree, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], {allowFailure: true}).status === 0) {
        throw new Error("integration merge must be committed before prepare can continue");
      }
      receipt.integrationCommit = output(git(receipt.integrationWorktree, ["rev-parse", "HEAD"]));
      receipt.status = "prepared";
      receipt.ci = {status: "pending", runs: []};
      saveReceipt(repository, receipt);
      appendLog(repository, taskId, "prepared_after_conflict", {integrationCommit: receipt.integrationCommit});
      return receipt;
    }
    if (!new Set(["started", "remote_moved"]).has(receipt.status)) {
      throw new Error(`delivery is not ready to prepare: ${receipt.status}`);
    }
    assertCleanWorktree(receipt.featureWorktree, "feature worktree");
    const featureCommit = output(git(receipt.featureWorktree, ["rev-parse", "HEAD"]));
    if (featureCommit === receipt.baseCommit) throw new Error("feature branch has no commits");
    const baseCommit = fetchBranch(repository.repositoryRoot, receipt.remote, receipt.defaultBranch);
    const history = Array.isArray(receipt.integrationHistory) ? receipt.integrationHistory : [];
    let mergeSource = receipt.featureBranch;
    let revision = history.length;
    if (receipt.status === "remote_moved") {
      assertCleanWorktree(receipt.integrationWorktree, "stale integration worktree");
      history.push({
        branch: receipt.integrationBranch,
        worktree: receipt.integrationWorktree,
        commit: receipt.integrationCommit,
        worktreeRemoved: true
      });
      git(repository.repositoryRoot, ["worktree", "remove", receipt.integrationWorktree]);
      mergeSource = receipt.integrationBranch;
      revision += 1;
    }
    const integrationBranch = revision === 0
      ? `codex/integrate-${taskId}`
      : `codex/integrate-${taskId}-r${revision}`;
    if (localBranchExists(repository.repositoryRoot, integrationBranch)) {
      throw new Error(`integration branch already exists: ${integrationBranch}`);
    }
    const root = integrationWorktreeRoot
      ? path.resolve(integrationWorktreeRoot)
      : managedWorktreeRoot(repository.repositoryRoot);
    const integrationWorktree = path.join(
      root,
      revision === 0 ? `${taskId}-integration` : `${taskId}-integration-r${revision}`
    );
    ensureUnusedPath(integrationWorktree);
    git(repository.repositoryRoot, [
      "worktree", "add", "-b", integrationBranch, integrationWorktree,
      `refs/remotes/${receipt.remote}/${receipt.defaultBranch}`
    ]);
    const merge = git(integrationWorktree, ["merge", "--no-ff", "--no-edit", mergeSource], {allowFailure: true});
    receipt.baseCommit = baseCommit;
    receipt.featureCommit = featureCommit;
    receipt.integrationBranch = integrationBranch;
    receipt.integrationWorktree = integrationWorktree;
    receipt.integrationHistory = history;
    if (merge.status !== 0) {
      receipt.status = "integration_conflict";
      saveReceipt(repository, receipt);
      appendLog(repository, taskId, "integration_conflict");
      throw new Error("integration merge has conflicts; resolve them in the preserved integration worktree");
    }
    receipt.integrationCommit = output(git(integrationWorktree, ["rev-parse", "HEAD"]));
    receipt.status = "prepared";
    receipt.ci = {status: "pending", runs: []};
    saveReceipt(repository, receipt);
    appendLog(repository, taskId, "prepared", {integrationCommit: receipt.integrationCommit});
    return receipt;
  });
}

function isProtectedBranchFailure(error) {
  if (!(error instanceof CommandError)) return false;
  const detail = `${error.result.stderr}\n${error.result.stdout}`;
  return /protected branch|GH006|GH013|repository rule|changes must be made through a pull request/i.test(detail);
}

function githubRepository(remote) {
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error("PR fallback requires a GitHub remote");
  return match[1];
}

function publishPullRequest(repository, receipt, githubRunner = run, repositoryName) {
  const repo = repositoryName ?? githubRepository(receipt.remoteUrl);
  git(repository.repositoryRoot, ["push", "-u", receipt.remote, `${receipt.integrationBranch}:refs/heads/${receipt.integrationBranch}`]);
  const title = `merge: deliver ${receipt.taskId}`;
  const body = [
    "## Summary",
    `- Complete managed iteration ${receipt.taskId}`,
    "- Merge only after required checks pass",
    "",
    "## Verification",
    `- ${receipt.verification.command}`
  ].join("\n");
  const created = githubRunner("gh", [
    "pr", "create", "--repo", repo, "--base", receipt.defaultBranch,
    "--head", receipt.integrationBranch, "--title", title, "--body", body
  ], {cwd: repository.repositoryRoot});
  const url = output(created);
  githubRunner("gh", ["pr", "merge", "--repo", repo, "--auto", "--merge", url], {cwd: repository.repositoryRoot});
  return {url, number: Number(url.match(/\/(\d+)$/)?.[1] ?? 0) || null};
}

function pushDefaultCommit(repository, receipt, integrationCommit) {
  try {
    git(repository.repositoryRoot, ["push", receipt.remote, `${integrationCommit}:refs/heads/${receipt.defaultBranch}`]);
    return {status: "pushed"};
  } catch (error) {
    if (!isProtectedBranchFailure(error)) throw error;
    return {status: "protected"};
  }
}

export function publishDelivery({
  projectRoot,
  taskId,
  verification,
  repair = false,
  pushDefault = pushDefaultCommit,
  githubRunner = run,
  githubRepositoryName
}) {
  const repository = resolveRepository(projectRoot);
  assertTaskId(taskId);
  return withTaskLock(repository, "integration", () => {
    const receipt = readDeliveryReceipt({projectRoot: repository.repositoryRoot, taskId});
    const allowed = repair ? new Set(["ci_failed", "pushed", "awaiting_ci"]) : new Set(["prepared"]);
    if (!allowed.has(receipt.status)) throw new Error(`delivery is not publishable: ${receipt.status}`);
    if (repair && receipt.repairAttempts >= MAX_REPAIR_ATTEMPTS) throw new Error("maximum CI repair attempts reached");
    assertCleanWorktree(receipt.integrationWorktree, "integration worktree");
    receipt.verification = verificationRecord(verification);
    const integrationCommit = output(git(receipt.integrationWorktree, ["rev-parse", "HEAD"]));
    const expectedRemoteCommit = repair ? receipt.remoteCommit : receipt.baseCommit;
    const actualRemoteCommit = remoteBranchCommit(repository.repositoryRoot, receipt.remote, receipt.defaultBranch);
    if (actualRemoteCommit !== expectedRemoteCommit) {
      receipt.status = "remote_moved";
      saveReceipt(repository, receipt);
      appendLog(repository, taskId, "remote_moved", {expectedRemoteCommit, actualRemoteCommit});
      throw new Error("remote default branch moved after integration; rebuild and reverify the merged result");
    }
    receipt.integrationCommit = integrationCommit;
    if (repair) receipt.repairAttempts += 1;

    if (receipt.mode === "pr") {
      git(repository.repositoryRoot, ["push", receipt.remote, `${receipt.integrationBranch}:refs/heads/${receipt.integrationBranch}`]);
      receipt.status = "awaiting_ci";
    } else {
      const push = pushDefault(repository, receipt, integrationCommit);
      if (!push || !new Set(["pushed", "protected"]).has(push.status)) throw new Error("invalid default push result");
      if (push.status === "pushed") {
        receipt.mode = "direct";
        receipt.status = "pushed";
      } else {
        receipt.mode = "pr";
        receipt.pullRequest = publishPullRequest(repository, receipt, githubRunner, githubRepositoryName);
        receipt.status = "awaiting_ci";
      }
    }
    receipt.remoteCommit = remoteBranchCommit(repository.repositoryRoot, receipt.remote, receipt.defaultBranch);
    receipt.ci = {status: "pending", runs: []};
    saveReceipt(repository, receipt);
    appendLog(repository, taskId, "published", {mode: receipt.mode, integrationCommit});
    return receipt;
  });
}

function resolveDirectCiStatus(repository, receipt) {
  const repo = githubRepository(receipt.remoteUrl);
  const listed = run("gh", [
    "run", "list", "--repo", repo, "--commit", receipt.integrationCommit,
    "--limit", "20", "--json", "databaseId,status,conclusion,url"
  ], {cwd: repository.repositoryRoot});
  const runs = JSON.parse(listed.stdout || "[]");
  if (runs.length === 0) {
    const workflows = run("gh", ["api", `repos/${repo}/actions/workflows`, "--jq", ".total_count"], {
      cwd: repository.repositoryRoot
    });
    return Number(output(workflows)) === 0
      ? {status: "not_configured", runs: []}
      : {status: "pending", runs: []};
  }
  if (runs.some(item => item.status !== "completed")) return {status: "pending", runs};
  const passing = new Set(["success", "neutral", "skipped"]);
  return runs.every(item => passing.has(item.conclusion))
    ? {status: "passed", runs}
    : {status: "failed", runs};
}

function resolvePullRequestStatus(repository, receipt) {
  const repo = githubRepository(receipt.remoteUrl);
  const viewed = run("gh", [
    "pr", "view", receipt.pullRequest.url, "--repo", repo,
    "--json", "state,mergeCommit,statusCheckRollup"
  ], {cwd: repository.repositoryRoot});
  const result = JSON.parse(viewed.stdout);
  const checks = Array.isArray(result.statusCheckRollup) ? result.statusCheckRollup : [];
  const failed = checks.some(item => ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(item.conclusion));
  if (failed) return {status: "failed", runs: checks};
  if (result.state === "MERGED" && checks.every(item => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(item.conclusion))) {
    return {status: "passed", runs: checks, mergeCommit: result.mergeCommit?.oid ?? null};
  }
  return {status: "pending", runs: checks};
}

function resolveGitHubCiStatus(repository, receipt) {
  return receipt.mode === "pr"
    ? resolvePullRequestStatus(repository, receipt)
    : resolveDirectCiStatus(repository, receipt);
}

export function refreshDeliveryStatus({projectRoot, taskId, resolveCiStatus = resolveGitHubCiStatus}) {
  const repository = resolveRepository(projectRoot);
  const receipt = readDeliveryReceipt({projectRoot: repository.repositoryRoot, taskId: assertTaskId(taskId)});
  if (!new Set(["pushed", "awaiting_ci", "ci_failed", "ci_passed"]).has(receipt.status)) {
    throw new Error(`delivery has not been published: ${receipt.status}`);
  }
  const ci = resolveCiStatus(repository, receipt);
  if (!ci || !CI_STATUSES.has(ci.status) || !Array.isArray(ci.runs)) throw new Error("invalid CI status result");
  receipt.ci = {status: ci.status, runs: ci.runs, checkedAt: new Date().toISOString()};
  if (ci.mergeCommit) receipt.remoteCommit = ci.mergeCommit;
  receipt.status = ci.status === "failed" ? "ci_failed" : CI_STATUSES.has(ci.status) && ci.status !== "pending" ? "ci_passed" : "awaiting_ci";
  saveReceipt(repository, receipt);
  appendLog(repository, taskId, "ci_status", {status: ci.status});
  return receipt;
}

function deleteRemoteBranchIfPresent(repository, receipt, branch) {
  if (!remoteBranchCommit(repository.repositoryRoot, receipt.remote, branch)) return false;
  git(repository.repositoryRoot, ["push", receipt.remote, "--delete", branch]);
  return true;
}

export function cleanupDelivery({projectRoot, taskId}) {
  const repository = resolveRepository(projectRoot);
  return withTaskLock(repository, assertTaskId(taskId), () => {
    const receipt = readDeliveryReceipt({projectRoot: repository.repositoryRoot, taskId});
    if (receipt.status !== "ci_passed" || !new Set(["passed", "not_configured"]).has(receipt.ci.status)) {
      throw new Error("delivery cannot be cleaned before CI passes");
    }
    fetchBranch(repository.repositoryRoot, receipt.remote, receipt.defaultBranch);
    const ancestor = git(repository.repositoryRoot, [
      "merge-base", "--is-ancestor", receipt.integrationCommit,
      `refs/remotes/${receipt.remote}/${receipt.defaultBranch}`
    ], {allowFailure: true});
    if (ancestor.status !== 0) throw new Error("integration commit is not contained in the remote default branch");
    assertCleanWorktree(receipt.featureWorktree, "feature worktree");
    assertCleanWorktree(receipt.integrationWorktree, "integration worktree");

    git(repository.repositoryRoot, ["worktree", "remove", receipt.featureWorktree]);
    receipt.cleanup.featureWorktreeRemoved = true;
    git(repository.repositoryRoot, ["worktree", "remove", receipt.integrationWorktree]);
    receipt.cleanup.integrationWorktreeRemoved = true;
    const managedBranches = [
      receipt.featureBranch,
      ...(receipt.integrationHistory ?? []).map(item => item.branch),
      receipt.integrationBranch
    ];
    for (const branch of managedBranches) {
      if (localBranchExists(repository.repositoryRoot, branch)) {
        git(repository.repositoryRoot, ["branch", "-d", branch]);
      }
    }
    receipt.cleanup.localBranchDeleted = true;
    for (const branch of managedBranches) deleteRemoteBranchIfPresent(repository, receipt, branch);
    receipt.cleanup.remoteBranchDeleted = managedBranches.every(branch => (
      remoteBranchCommit(repository.repositoryRoot, receipt.remote, branch) === null
    ));
    if (!receipt.cleanup.remoteBranchDeleted) throw new Error("managed remote branch still exists after cleanup");
    receipt.status = "cleaned";
    saveReceipt(repository, receipt);
    appendLog(repository, taskId, "cleaned");
    return receipt;
  });
}

export function rollbackDelivery({projectRoot, taskId, verification}) {
  const repository = resolveRepository(projectRoot);
  assertTaskId(taskId);
  return withTaskLock(repository, "integration", () => {
    const receipt = readDeliveryReceipt({projectRoot: repository.repositoryRoot, taskId});
    if (receipt.mode !== "direct" || receipt.status !== "ci_failed") throw new Error("only a failed direct delivery can be rolled back");
    if (receipt.repairAttempts < MAX_REPAIR_ATTEMPTS) throw new Error("CI repair attempts are not exhausted");
    if (remoteBranchCommit(repository.repositoryRoot, receipt.remote, receipt.defaultBranch) !== receipt.remoteCommit) {
      throw new Error("remote tip is not exclusively owned by this task");
    }
    assertCleanWorktree(receipt.integrationWorktree, "integration worktree");
    if (output(git(receipt.integrationWorktree, ["rev-parse", "HEAD"])) !== receipt.remoteCommit) {
      throw new Error("integration worktree does not match the remote tip");
    }
    const commits = output(git(receipt.integrationWorktree, [
      "rev-list", "--first-parent", "--reverse", `${receipt.baseCommit}..HEAD`
    ]))
      .split("\n").filter(Boolean).reverse();
    for (const commit of commits) {
      const parents = output(git(receipt.integrationWorktree, ["rev-list", "--parents", "-n", "1", commit])).split(/\s+/);
      const args = parents.length > 2 ? ["revert", "-m", "1", "--no-edit", commit] : ["revert", "--no-edit", commit];
      git(receipt.integrationWorktree, args);
    }
    receipt.verification = verificationRecord(verification);
    const rollbackCommit = output(git(receipt.integrationWorktree, ["rev-parse", "HEAD"]));
    git(repository.repositoryRoot, ["push", receipt.remote, `${rollbackCommit}:refs/heads/${receipt.defaultBranch}`]);
    receipt.rollback = {status: "pushed", commit: rollbackCommit, at: new Date().toISOString()};
    receipt.remoteCommit = rollbackCommit;
    receipt.status = "rolled_back";
    saveReceipt(repository, receipt);
    appendLog(repository, taskId, "rolled_back", {rollbackCommit});
    return receipt;
  });
}

export function validateCleanedDelivery({projectRoot, taskId}) {
  const repository = resolveRepository(projectRoot);
  const receipt = readDeliveryReceipt({projectRoot: repository.repositoryRoot, taskId: assertTaskId(taskId)});
  if (receipt.status !== "cleaned") throw new Error("delivery receipt is not cleaned");
  if (!new Set(["passed", "not_configured"]).has(receipt.ci.status)) throw new Error("delivery CI is not passing");
  fetchBranch(repository.repositoryRoot, receipt.remote, receipt.defaultBranch);
  const ancestor = git(repository.repositoryRoot, [
    "merge-base", "--is-ancestor", receipt.integrationCommit,
    `refs/remotes/${receipt.remote}/${receipt.defaultBranch}`
  ], {allowFailure: true});
  if (ancestor.status !== 0) throw new Error("delivery commit is not contained in the remote default branch");
  const managedBranches = [
    receipt.featureBranch,
    ...(receipt.integrationHistory ?? []).map(item => item.branch),
    receipt.integrationBranch
  ];
  for (const branch of managedBranches) {
    if (localBranchExists(repository.repositoryRoot, branch)) throw new Error(`managed local branch still exists: ${branch}`);
    if (remoteBranchCommit(repository.repositoryRoot, receipt.remote, branch)) throw new Error(`managed remote branch still exists: ${branch}`);
  }
  const managedWorktrees = [
    receipt.featureWorktree,
    ...(receipt.integrationHistory ?? []).map(item => item.worktree),
    receipt.integrationWorktree
  ];
  for (const worktree of managedWorktrees) {
    if (fs.existsSync(worktree)) throw new Error(`managed worktree still exists: ${worktree}`);
  }
  return receipt;
}

function parseCli(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const actions = ["--start", "--prepare", "--publish", "--status", "--cleanup", "--rollback"].filter(item => args.includes(item));
  if (actions.length !== 1) throw new Error("use exactly one delivery action");
  const options = {action: actions[0].slice(2), repair: args.includes("--repair")};
  const valued = new Set([
    "--project", "--task-id", "--slug", "--remote", "--worktree-root",
    "--verification-command", "--verification-status", "--verification-duration-seconds"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (actions.includes(argument) || argument === "--repair") continue;
    if (!valued.has(argument)) throw new Error(`unknown option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!options.project || !options.task_id) throw new Error("--project and --task-id are required");
  return options;
}

function usage() {
  return [
    "用法：iteration-delivery.mjs <action> --project <目录> --task-id <ID> [选项]",
    "",
    "动作：--start、--prepare、--publish、--status、--cleanup、--rollback。",
    "发布和回滚要求 --verification-command、--verification-status passed、--verification-duration-seconds。"
  ].join("\n");
}

function cliVerification(options) {
  return {
    command: options.verification_command,
    status: options.verification_status,
    durationSeconds: Number(options.verification_duration_seconds)
  };
}

function main(args) {
  const options = parseCli(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const common = {projectRoot: options.project, taskId: options.task_id};
  let result;
  if (options.action === "start") {
    result = startDelivery({...common, slug: options.slug ?? options.task_id, remote: options.remote ?? "origin", worktreeRoot: options.worktree_root});
  } else if (options.action === "prepare") {
    result = prepareDelivery({...common, integrationWorktreeRoot: options.worktree_root});
  } else if (options.action === "publish") {
    result = publishDelivery({...common, verification: cliVerification(options), repair: options.repair});
  } else if (options.action === "status") {
    result = refreshDeliveryStatus(common);
  } else if (options.action === "cleanup") {
    result = cleanupDelivery(common);
  } else {
    result = rollbackDelivery({...common, verification: cliVerification(options)});
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`iteration delivery failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export {MAX_REPAIR_ATTEMPTS};
