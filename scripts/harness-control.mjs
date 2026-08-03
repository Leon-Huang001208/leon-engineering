import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildProfile} from "./profile-project.mjs";

export const CONTROL_FILENAME = "control-plane.json";
const HARNESS_DIRECTORY = ".ai/harness";
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const COMMIT = /^[0-9a-f]{7,64}$/;
const TRANSITIONS = {
  ready: new Set(["in_progress"]),
  in_progress: new Set(["blocked", "failed", "completed"]),
  planned: new Set(),
  blocked: new Set(),
  failed: new Set(),
  completed: new Set()
};

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertSafeExistingDirectory(root, relative) {
  const destination = path.resolve(root, relative);
  if (!isWithin(root, destination)) throw new Error("unsafe harness destination");
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) return null;
    if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error("invalid harness directory");
    }
  }
  return destination;
}

function writeAtomically(destination, content) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function assertText(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`);
  return value.trim();
}

function assertTaskId(value) {
  if (typeof value !== "string" || !TASK_ID.test(value)) throw new Error("invalid task id");
  return value;
}

function assertAcceptanceCriteria(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("at least one acceptance criterion is required");
  return value.map(item => assertText(item, "acceptance criterion"));
}

function assertDependencies(value, taskId) {
  if (!Array.isArray(value)) throw new Error("dependsOn must be an array");
  const dependencies = value.map(assertTaskId);
  if (new Set(dependencies).size !== dependencies.length) throw new Error("duplicate dependency");
  if (dependencies.includes(taskId)) throw new Error("task cannot depend on itself");
  return dependencies;
}

function assertNoCycles(tasks) {
  const known = new Set(tasks.map(task => task.id));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!known.has(dependency)) throw new Error(`unknown dependency: ${dependency}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(tasks.map(task => [task.id, task]));
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("dependency cycle");
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
}

function dependenciesCompleted(task, tasks) {
  const byId = new Map(tasks.map(item => [item.id, item]));
  return task.dependsOn.every(id => byId.get(id).status === "completed");
}

function addEvent(control, event, details = {}) {
  control.events.push({timestamp: new Date().toISOString(), event, ...details});
}

function refreshReadyTasks(control, {recordEvents = true} = {}) {
  for (const task of control.tasks) {
    if (task.status === "planned" && dependenciesCompleted(task, control.tasks)) {
      task.status = "ready";
      if (recordEvents) addEvent(control, "dependency_unblocked", {taskId: task.id});
    }
  }
}

function normalizedTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("task is required");
  const id = assertTaskId(task.id);
  return {
    id,
    goal: assertText(task.goal, "task goal"),
    acceptanceCriteria: assertAcceptanceCriteria(task.acceptanceCriteria),
    dependsOn: assertDependencies(task.dependsOn ?? [], id),
    status: "planned",
    attempts: 0,
    worktree: null
  };
}

function assertStoredTask(task) {
  const normalized = normalizedTask(task);
  if (!Object.hasOwn(TRANSITIONS, task.status)) throw new Error("invalid task status");
  if (!Number.isInteger(task.attempts) || task.attempts < 0) throw new Error("invalid task attempts");
  if (task.worktree !== null) normalizeWorktree(task.worktree);
  return {...normalized, status: task.status, attempts: task.attempts, worktree: task.worktree ?? null};
}

function normalizeWorktree(worktree) {
  if (!worktree || typeof worktree !== "object" || Array.isArray(worktree)) throw new Error("worktree is required");
  const worktreePath = assertText(worktree.path, "worktree path");
  if (!path.isAbsolute(worktreePath)) throw new Error("worktree path must be absolute");
  const branch = assertText(worktree.branch, "worktree branch");
  const baseCommit = assertText(worktree.baseCommit, "worktree base commit");
  if (!COMMIT.test(baseCommit)) throw new Error("invalid worktree base commit");
  return {path: path.resolve(worktreePath), branch, baseCommit};
}

function assertControl(control, root) {
  if (!control || typeof control !== "object" || Array.isArray(control)) throw new Error("control plane is required");
  if (control.schemaVersion !== 1) throw new Error("invalid control plane schema version");
  if (control.projectRoot !== root) throw new Error("control plane project root mismatch");
  if (!Array.isArray(control.tasks) || control.tasks.length === 0) throw new Error("at least one task is required");
  const tasks = control.tasks.map(assertStoredTask);
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("duplicate task id");
  assertNoCycles(tasks);
  if (!Array.isArray(control.events)) throw new Error("invalid control plane events");
  return {schemaVersion: 1, projectRoot: root, tasks, events: control.events};
}

function rootFor(projectRoot) {
  return buildProfile({projectRoot}).projectRoot;
}

function controlPath(root) {
  const directory = assertSafeExistingDirectory(root, HARNESS_DIRECTORY);
  if (!directory) throw new Error("missing task harness");
  return {directory, control: path.join(directory, CONTROL_FILENAME)};
}

function readTaskPlan(projectRoot, taskPlanPath) {
  const rawCandidate = path.resolve(projectRoot, assertText(taskPlanPath, "task plan"));
  if (!fs.existsSync(rawCandidate)) throw new Error("missing task plan");
  const candidate = path.join(fs.realpathSync(path.dirname(rawCandidate)), path.basename(rawCandidate));
  if (!isWithin(projectRoot, candidate)) throw new Error("unsafe task plan");
  let current = projectRoot;
  for (const part of path.relative(projectRoot, candidate).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new Error("missing task plan");
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("invalid task plan");
  }
  if (!fs.statSync(candidate).isFile()) throw new Error("invalid task plan");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
  } catch {
    throw new Error("invalid task plan JSON");
  }
  return Array.isArray(parsed) ? parsed : parsed?.tasks;
}

export function buildControlPlane({projectRoot, tasks}) {
  const root = rootFor(projectRoot);
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("at least one task is required");
  const normalized = tasks.map(normalizedTask);
  if (new Set(normalized.map(task => task.id)).size !== normalized.length) throw new Error("duplicate task id");
  assertNoCycles(normalized);
  const control = {schemaVersion: 1, projectRoot: root, tasks: normalized, events: []};
  refreshReadyTasks(control, {recordEvents: false});
  return control;
}

export function previewControlPlane(control) {
  const normalized = assertControl(control, control?.projectRoot);
  return {
    taskCount: normalized.tasks.length,
    readyTaskIds: normalized.tasks.filter(task => task.status === "ready").map(task => task.id),
    blockedTaskIds: normalized.tasks.filter(task => task.status === "blocked").map(task => task.id),
    failedTaskIds: normalized.tasks.filter(task => task.status === "failed").map(task => task.id)
  };
}

export function writeControlPlane({projectRoot, control}) {
  const root = rootFor(projectRoot);
  const normalized = assertControl(control, root);
  const {directory, control: destination} = controlPath(root);
  if (!fs.existsSync(path.join(directory, "agent-map.md")) || !fs.existsSync(path.join(directory, "metrics.jsonl"))) {
    throw new Error("missing task harness");
  }
  if (fs.existsSync(destination) || fs.lstatSync(directory).isSymbolicLink()) throw new Error("existing control plane");
  addEvent(normalized, "control_plane_created");
  writeAtomically(destination, `${JSON.stringify(normalized, null, 2)}\n`);
  return {directory, control: destination};
}

export function readControlPlane({projectRoot}) {
  const root = rootFor(projectRoot);
  const {control} = controlPath(root);
  if (!fs.existsSync(control)) throw new Error("missing control plane");
  if (fs.lstatSync(control).isSymbolicLink() || !fs.statSync(control).isFile()) throw new Error("invalid control plane");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(control, "utf8"));
  } catch {
    throw new Error("invalid control plane JSON");
  }
  return assertControl(parsed, root);
}

function updateControl(projectRoot, updater) {
  const root = rootFor(projectRoot);
  const {control: destination} = controlPath(root);
  const control = readControlPlane({projectRoot: root});
  updater(control);
  writeAtomically(destination, `${JSON.stringify(control, null, 2)}\n`);
  return control;
}

function getTask(control, taskId) {
  const id = assertTaskId(taskId);
  const task = control.tasks.find(item => item.id === id);
  if (!task) throw new Error("unknown task id");
  return task;
}

export function transitionTask({projectRoot, taskId, status, reason}) {
  const nextStatus = assertText(status, "task status");
  const transitionReason = assertText(reason, "transition reason");
  return updateControl(projectRoot, control => {
    const task = getTask(control, taskId);
    if (!TRANSITIONS[task.status].has(nextStatus)) throw new Error("invalid task transition");
    task.status = nextStatus;
    addEvent(control, "task_transition", {taskId: task.id, status: nextStatus, reason: transitionReason});
    if (nextStatus === "completed") refreshReadyTasks(control);
  });
}

export function retryTask({projectRoot, taskId, reason}) {
  const retryReason = assertText(reason, "retry reason");
  return updateControl(projectRoot, control => {
    const task = getTask(control, taskId);
    if (!new Set(["blocked", "failed"]).has(task.status)) throw new Error("only blocked or failed tasks can retry");
    task.attempts += 1;
    task.status = dependenciesCompleted(task, control.tasks) ? "ready" : "planned";
    addEvent(control, "task_retry", {taskId: task.id, status: task.status, reason: retryReason, attempts: task.attempts});
  });
}

export function registerWorktree({projectRoot, taskId, worktree}) {
  const declaredWorktree = normalizeWorktree(worktree);
  return updateControl(projectRoot, control => {
    const task = getTask(control, taskId);
    if (!new Set(["ready", "in_progress", "blocked", "failed"]).has(task.status)) throw new Error("cannot register worktree for completed or planned task");
    task.worktree = declaredWorktree;
    addEvent(control, "worktree_registered", {taskId: task.id, worktree: declaredWorktree});
  });
}

function parseArgs(args) {
  const options = {};
  const valueOptions = new Set(["--project", "--task-plan", "--task-id", "--status", "--reason", "--worktree", "--branch", "--base-commit"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valueOptions.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (["--write-control-plane", "--transition", "--retry", "--register-worktree", "--show"].includes(argument)) {
      options[argument.slice(2).replaceAll("-", "_")] = true;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.project) throw new Error("--project requires a value");
  const modes = [options.task_plan ? "plan" : null, options.transition ? "transition" : null, options.retry ? "retry" : null, options.register_worktree ? "worktree" : null, options.show ? "show" : null].filter(Boolean);
  if (modes.length !== 1) throw new Error("select exactly one control plane operation");
  if (options.write_control_plane && !options.task_plan) throw new Error("--write-control-plane requires --task-plan");
  if (options.task_plan) return options;
  if (options.show) return options;
  if (!options.task_id) throw new Error("--task-id requires a value");
  if (options.transition && (!options.status || !options.reason)) throw new Error("--transition requires --status and --reason");
  if (options.retry && !options.reason) throw new Error("--retry requires --reason");
  if (options.register_worktree && (!options.worktree || !options.branch || !options.base_commit)) {
    throw new Error("--register-worktree requires --worktree, --branch, and --base-commit");
  }
  return options;
}

function main(args) {
  const options = parseArgs(args);
  if (options.task_plan) {
    const root = rootFor(options.project);
    const controlPlane = buildControlPlane({projectRoot: root, tasks: readTaskPlan(root, options.task_plan)});
    const files = options.write_control_plane ? writeControlPlane({projectRoot: root, control: controlPlane}) : null;
    process.stdout.write(`${JSON.stringify({persisted: Boolean(files), controlPlane, preview: previewControlPlane(controlPlane), files}, null, 2)}\n`);
    return;
  }
  if (options.show) {
    process.stdout.write(`${JSON.stringify({controlPlane: readControlPlane({projectRoot: options.project})}, null, 2)}\n`);
    return;
  }
  const controlPlane = options.transition
    ? transitionTask({projectRoot: options.project, taskId: options.task_id, status: options.status, reason: options.reason})
    : options.retry
      ? retryTask({projectRoot: options.project, taskId: options.task_id, reason: options.reason})
      : registerWorktree({projectRoot: options.project, taskId: options.task_id, worktree: {path: options.worktree, branch: options.branch, baseCommit: options.base_commit}});
  process.stdout.write(`${JSON.stringify({persisted: true, controlPlane}, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness control failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
