import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildProfile} from "./profile-project.mjs";

export const HARNESS_DIRECTORY = ".ai/harness";
export const AGENT_MAP_FILENAME = "agent-map.md";
export const METRICS_FILENAME = "metrics.jsonl";

function assertTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("task is required");
  if (typeof task.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(task.id)) {
    throw new Error("invalid task id");
  }
  if (typeof task.goal !== "string" || task.goal.trim().length === 0) throw new Error("task goal is required");
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    throw new Error("at least one acceptance criterion is required");
  }
  const acceptanceCriteria = task.acceptanceCriteria.map(item => {
    if (typeof item !== "string" || item.trim().length === 0) throw new Error("invalid acceptance criterion");
    return item.trim();
  });
  return {id: task.id, goal: task.goal.trim(), acceptanceCriteria};
}

export function buildHarness({projectRoot, task}) {
  const profile = buildProfile({projectRoot});
  const normalizedTask = assertTask(task);
  return {
    schemaVersion: 1,
    projectRoot: profile.projectRoot,
    profile: {
      instructions: profile.instructions,
      commands: profile.commands,
      ci: profile.ci,
      platformSignals: profile.platformSignals,
      uncertainties: profile.uncertainties
    },
    task: {
      ...normalizedTask,
      status: "ready",
      verification: {status: "not_run"}
    }
  };
}

export function formatAgentMap(harness) {
  const instructionLines = harness.profile.instructions.length === 0
    ? ["- No project instruction file was discovered."]
    : harness.profile.instructions.map(item => `- \`${item.path}\` (${item.kind})`);
  const commandLines = harness.profile.commands.length === 0
    ? ["- No candidate validation command was discovered."]
    : harness.profile.commands.map(item => `- \`${item.command}\` from \`${item.source}\` (candidate only)`);
  const ciLines = harness.profile.ci.length === 0
    ? ["- No CI workflow was discovered."]
    : harness.profile.ci.map(item => `- \`${item.path}\``);
  return [
    "# Agent Map",
    "",
    "This file is generated from bounded, local repository evidence. Project instructions override this map.",
    "",
    "## Start Here",
    "",
    ...instructionLines,
    "",
    "## Candidate Validation Commands",
    "",
    ...commandLines,
    "",
    "## CI Evidence",
    "",
    ...ciLines,
    "",
    "## Handoff Rule",
    "",
    "Read the task record before changing code. Record only executed verification evidence with --record-outcome; candidate commands are not proof of success."
  ].join("\n");
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeDirectory(root, relative) {
  const destination = path.resolve(root, relative);
  if (!isWithin(root, destination)) throw new Error("unsafe harness destination");
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current, {mode: 0o700});
    else if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error("invalid harness directory");
    }
  }
  return destination;
}

function existingSafeDirectory(root, relative) {
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

function taskFile(directory, taskId) {
  return path.join(directory, "tasks", `${taskId}.json`);
}

function metricEvent(event, taskId, details = {}) {
  return {timestamp: new Date().toISOString(), event, taskId, ...details};
}

export function writeHarness({projectRoot, harness}) {
  if (!harness || harness.projectRoot !== buildProfile({projectRoot}).projectRoot) {
    throw new Error("harness project root mismatch");
  }
  const directory = safeDirectory(harness.projectRoot, HARNESS_DIRECTORY);
  const tasks = safeDirectory(harness.projectRoot, path.posix.join(HARNESS_DIRECTORY, "tasks"));
  const map = path.join(directory, AGENT_MAP_FILENAME);
  const task = taskFile(directory, harness.task.id);
  const metrics = path.join(directory, METRICS_FILENAME);
  if (fs.existsSync(map) || fs.existsSync(metrics) || fs.existsSync(task)) {
    throw new Error("existing harness or task");
  }
  if (!isWithin(tasks, task)) throw new Error("unsafe task destination");
  writeAtomically(map, `${formatAgentMap(harness)}\n`);
  writeAtomically(task, `${JSON.stringify(harness.task, null, 2)}\n`);
  writeAtomically(metrics, `${JSON.stringify(metricEvent("task_created", harness.task.id, {status: harness.task.status}))}\n`);
  return {directory, map, task, metrics};
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`invalid ${field}`);
  return value;
}

export function recordOutcome({projectRoot, taskId, outcome}) {
  const root = buildProfile({projectRoot}).projectRoot;
  if (typeof taskId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(taskId)) throw new Error("invalid task id");
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) throw new Error("outcome is required");
  if (!new Set(["completed", "blocked", "rework"]).has(outcome.status)) throw new Error("invalid outcome status");
  if (typeof outcome.verificationCommand !== "string" || outcome.verificationCommand.trim().length === 0) {
    throw new Error("verification command is required");
  }
  if (!new Set(["passed", "failed", "not_run"]).has(outcome.verificationStatus)) {
    throw new Error("invalid verification status");
  }
  const record = {
    status: outcome.status,
    clarificationRounds: nonNegativeInteger(outcome.clarificationRounds, "clarification rounds"),
    reworkCount: nonNegativeInteger(outcome.reworkCount, "rework count"),
    verification: {command: outcome.verificationCommand.trim(), status: outcome.verificationStatus}
  };
  const directory = existingSafeDirectory(root, HARNESS_DIRECTORY);
  if (!directory) throw new Error("missing task harness");
  const task = taskFile(directory, taskId);
  const metrics = path.join(directory, METRICS_FILENAME);
  if (!fs.existsSync(task) || !fs.existsSync(metrics)) throw new Error("missing task harness");
  let taskRecord;
  try {
    taskRecord = JSON.parse(fs.readFileSync(task, "utf8"));
  } catch {
    throw new Error("invalid task record");
  }
  taskRecord.status = record.status;
  taskRecord.verification = record.verification;
  taskRecord.outcomes = [...(Array.isArray(taskRecord.outcomes) ? taskRecord.outcomes : []), record];
  writeAtomically(task, `${JSON.stringify(taskRecord, null, 2)}\n`);
  fs.appendFileSync(metrics, `${JSON.stringify(metricEvent("task_outcome", taskId, record))}\n`, {mode: 0o600});
  return record;
}

function parseArgs(args) {
  const options = {acceptanceCriteria: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--task-id", "--goal", "--acceptance", "--status", "--clarification-rounds", "--rework-count", "--verification-command", "--verification-status"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--acceptance") options.acceptanceCriteria.push(value);
      else options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (argument === "--write-harness") options.writeHarness = true;
    else if (argument === "--record-outcome") options.recordOutcome = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.project) throw new Error("--project requires a value");
  if (!options.task_id) throw new Error("--task-id requires a value");
  if (options.recordOutcome) {
    if (options.writeHarness || options.goal || options.acceptanceCriteria.length) {
      throw new Error("outcome mode cannot create a task");
    }
    return options;
  }
  if (!options.goal || options.acceptanceCriteria.length === 0) {
    throw new Error("--goal and at least one --acceptance are required");
  }
  return options;
}

function main(args) {
  const options = parseArgs(args);
  if (options.recordOutcome) {
    const result = recordOutcome({
      projectRoot: options.project,
      taskId: options.task_id,
      outcome: {
        status: options.status,
        clarificationRounds: Number(options.clarification_rounds),
        reworkCount: Number(options.rework_count),
        verificationCommand: options.verification_command,
        verificationStatus: options.verification_status
      }
    });
    process.stdout.write(`${JSON.stringify({recorded: true, result})}\n`);
    return;
  }
  const harness = buildHarness({
    projectRoot: options.project,
    task: {id: options.task_id, goal: options.goal, acceptanceCriteria: options.acceptanceCriteria}
  });
  const files = options.writeHarness ? writeHarness({projectRoot: options.project, harness}) : null;
  process.stdout.write(`${JSON.stringify({persisted: Boolean(files), harness, files}, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness project failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
