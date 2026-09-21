import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildProfile} from "./profile-project.mjs";
import {
  HARNESS_DIRECTORY,
  TASK_INDEX_FILENAME,
  buildTaskIndexRecord,
  readAllHarnessEvents,
  readHarnessEvents,
  readHarnessTask,
  readHarnessTaskIndex
} from "./harness-project.mjs";

const OUTCOME_STATUSES = new Set(["completed", "blocked", "rework", "invalidated"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed", "not_run"]);
const BLOCKER_CATEGORIES = new Set(["environment", "dependency", "permission", "requirements", "test", "external", "unknown"]);

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
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

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`invalid ${field}`);
  return value;
}

function assertOutcome(outcome) {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) throw new Error("invalid task outcome");
  if (!OUTCOME_STATUSES.has(outcome.status)) throw new Error("invalid task outcome status");
  nonNegativeInteger(outcome.clarificationRounds, "clarification rounds");
  nonNegativeInteger(outcome.reworkCount, "rework count");
  if (!outcome.verification || typeof outcome.verification !== "object" || Array.isArray(outcome.verification)) {
    throw new Error("invalid task verification");
  }
  if (typeof outcome.verification.command !== "string" || outcome.verification.command.trim().length === 0) {
    throw new Error("invalid task verification command");
  }
  if (!VERIFICATION_STATUSES.has(outcome.verification.status)) throw new Error("invalid task verification status");
  if (outcome.verificationDurationSeconds !== undefined) {
    nonNegativeInteger(outcome.verificationDurationSeconds, "verification duration seconds");
  }
  if (outcome.blockerCategory !== undefined) {
    if (outcome.status !== "blocked" || !BLOCKER_CATEGORIES.has(outcome.blockerCategory)) {
      throw new Error("invalid blocker category");
    }
  }
  if (outcome.invalidReason !== undefined && (outcome.status !== "invalidated" || typeof outcome.invalidReason !== "string" || outcome.invalidReason.trim().length === 0)) {
    throw new Error("invalid invalid reason");
  }
  if (outcome.status === "invalidated" && (typeof outcome.invalidReason !== "string" || outcome.invalidReason.trim().length === 0)) {
    throw new Error("invalid invalid reason");
  }
  return outcome;
}

function readTaskRecords(directory) {
  const records = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile() || path.extname(entry.name) !== ".json") {
      throw new Error("invalid harness task entry");
    }
    let task;
    try {
      task = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error("invalid task record");
    }
    if (!task || typeof task !== "object" || Array.isArray(task) || !Array.isArray(task.outcomes)) {
      throw new Error("invalid task record");
    }
    task.outcomes.forEach(assertOutcome);
    records.push({id: entry.name.slice(0, -".json".length), outcomes: task.outcomes});
  }
  return records;
}

function readTargetTaskRecord(projectRoot, taskId) {
  const task = readHarnessTask({projectRoot, taskId});
  if (!Array.isArray(task.outcomes)) throw new Error("invalid task record");
  task.outcomes.forEach(assertOutcome);
  return {id: taskId, outcomes: task.outcomes};
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function average(values) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function summarizeReasoningMethods(records, eventsByTask) {
  const terminalByTask = new Map(records.map(record => [record.id, record.outcomes.at(-1)]));
  const selected = [];
  const completed = [];
  const selectionsByTask = new Map();
  for (const [taskId, events] of eventsByTask) {
    for (const event of events) {
      if (event.event === "reasoning_method_selected") {
        selected.push(event);
        const methods = selectionsByTask.get(taskId) ?? new Set();
        methods.add(event.methodId);
        selectionsByTask.set(taskId, methods);
      } else if (event.event === "reasoning_method_completed") completed.push(event);
    }
  }
  const byMethod = {};
  for (const event of selected) {
    const summary = byMethod[event.methodId] ?? {selected: 0, completed: 0, passedTasks: 0, reworkTasks: 0};
    summary.selected += 1;
    byMethod[event.methodId] = summary;
  }
  for (const event of completed) {
    const summary = byMethod[event.methodId] ?? {selected: 0, completed: 0, passedTasks: 0, reworkTasks: 0};
    summary.completed += 1;
    byMethod[event.methodId] = summary;
  }
  for (const [taskId, methods] of selectionsByTask) {
    const outcome = terminalByTask.get(taskId);
    for (const methodId of methods) {
      if (outcome?.status === "completed" && outcome.verification.status === "passed") byMethod[methodId].passedTasks += 1;
      if ((outcome?.reworkCount ?? 0) > 0) byMethod[methodId].reworkTasks += 1;
    }
  }
  return {
    selectedCount: selected.length,
    completedCount: completed.length,
    tasksWithSelection: selectionsByTask.size,
    adoptionRate: ratio(selectionsByTask.size, records.length),
    combinationTaskCount: [...selectionsByTask.values()].filter(methods => methods.size > 1).length,
    completionRate: ratio(completed.length, selected.length),
    byMethod
  };
}

function readMetrics(directory, taskId) {
  const file = path.join(directory, "metrics.jsonl");
  if (!fs.existsSync(file)) throw new Error("missing task harness");
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("invalid harness metrics");
  const metrics = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error("invalid harness metrics");
    }
  });
  return taskId === undefined ? metrics : metrics.filter(metric => metric?.taskId === taskId);
}

function summarizeObservations(metrics) {
  const recorded = metrics.filter(metric => metric?.event === "observation_recorded");
  const recalled = metrics.filter(metric => metric?.event === "observation_recalled");
  const fullBytes = recorded.reduce((total, metric) => total + metric.fullBytes, 0);
  const returnedBytes = recorded.reduce((total, metric) => total + metric.returnedBytes, 0);
  const archiveFailureCount = recorded.filter(metric => metric.archiveFailed === true).length;
  const statusCounts = {};
  const byVerifier = new Map();
  for (const metric of recorded) {
    if (typeof metric.verifierId !== "string" || typeof metric.status !== "string"
      || !Number.isInteger(metric.fullBytes) || metric.fullBytes < 0
      || !Number.isInteger(metric.returnedBytes) || metric.returnedBytes < 0
      || !Number.isInteger(metric.durationMs) || metric.durationMs < 0
      || typeof metric.truncated !== "boolean" || typeof metric.archiveFailed !== "boolean") {
      throw new Error("invalid observation metric");
    }
    statusCounts[metric.status] = (statusCounts[metric.status] ?? 0) + 1;
    const statuses = byVerifier.get(metric.verifierId) ?? [];
    statuses.push(metric.status);
    byVerifier.set(metric.verifierId, statuses);
  }
  const repeated = [...byVerifier.values()].filter(statuses => statuses.length > 1);
  const consistentVerifierCount = repeated.filter(statuses => new Set(statuses).size === 1).length;
  return {
    sampleSize: recorded.length,
    fullBytes,
    returnedBytes,
    returnedByteRatio: ratio(returnedBytes, fullBytes),
    recallCount: recalled.length,
    recallRate: ratio(recalled.length, recorded.length),
    archiveFailureCount,
    archiveFailureRate: ratio(archiveFailureCount, recorded.length),
    consistencySampleSize: repeated.length,
    consistentVerifierCount,
    verifierResultConsistencyRate: ratio(consistentVerifierCount, repeated.length),
    statusCounts
  };
}

function summarize(records, eventsByTask, metrics) {
  const terminal = records.filter(record => record.outcomes.length > 0).map(record => ({...record, outcome: record.outcomes.at(-1)}));
  const completedPassed = terminal.filter(record => record.outcome.status === "completed" && record.outcome.verification.status === "passed");
  const firstPass = completedPassed.filter(record => (record.outcomeCount ?? record.outcomes.length) === 1 && record.outcome.reworkCount === 0);
  const durations = terminal.map(record => record.outcome.verificationDurationSeconds).filter(value => value !== undefined);
  const blockerCategories = {};
  for (const record of terminal) {
    if (record.outcome.status === "blocked" && record.outcome.blockerCategory) {
      blockerCategories[record.outcome.blockerCategory] = (blockerCategories[record.outcome.blockerCategory] ?? 0) + 1;
    }
  }
  return {
    taskCount: records.length,
    terminalTaskCount: terminal.length,
    completedPassedCount: completedPassed.length,
    firstPassCompletedCount: firstPass.length,
    firstPassRate: ratio(firstPass.length, terminal.length),
    averageClarificationRounds: average(terminal.map(record => record.outcome.clarificationRounds)),
    averageReworkCount: average(terminal.map(record => record.outcome.reworkCount)),
    verificationDurationCoverage: ratio(durations.length, terminal.length),
    averageVerificationDurationSeconds: average(durations),
    blockerCategories,
    observations: summarizeObservations(metrics),
    reasoningMethods: summarizeReasoningMethods(records, eventsByTask)
  };
}

function recordFromIndex(entry) {
  const outcome = entry.outcome ? {
    status: entry.outcome.status,
    clarificationRounds: entry.outcome.clarificationRounds,
    reworkCount: entry.outcome.reworkCount,
    verification: {command: "indexed-summary", status: entry.outcome.verificationStatus},
    ...(entry.outcome.verificationDurationSeconds !== undefined ? {verificationDurationSeconds: entry.outcome.verificationDurationSeconds} : {}),
    ...(entry.outcome.blockerCategory ? {blockerCategory: entry.outcome.blockerCategory} : {}),
    ...(entry.outcome.invalidReason ? {invalidReason: entry.outcome.invalidReason} : {})
  } : null;
  return {id: entry.taskId, outcomeCount: entry.outcomeCount, outcomes: outcome ? [outcome] : []};
}

function listedTaskIds(tasks) {
  return fs.readdirSync(tasks, {withFileTypes: true})
    .filter(entry => entry.isFile() && !entry.isSymbolicLink() && path.extname(entry.name) === ".json")
    .map(entry => entry.name.slice(0, -5))
    .sort();
}

export function evaluateHarness({projectRoot, taskId, all = false}) {
  const root = buildProfile({projectRoot}).projectRoot;
  const directory = existingSafeDirectory(root, HARNESS_DIRECTORY);
  if (!directory) throw new Error("missing task harness");
  const tasks = existingSafeDirectory(root, path.posix.join(HARNESS_DIRECTORY, "tasks"));
  if (!tasks) throw new Error("missing task harness");
  if (taskId !== undefined) {
    const records = [readTargetTaskRecord(root, taskId)];
    const eventsByTask = new Map([[taskId, readHarnessEvents({projectRoot: root, taskId})]]);
    return {
      schemaVersion: 1,
      projectRoot: root,
      health: {complete: true, invalidIndexEntries: 0, unindexedTasks: [], timedOutRecords: []},
      summary: summarize(records, eventsByTask, readMetrics(directory, taskId))
    };
  }
  if (!all) throw new Error("use --task-id or --all");
  const index = readHarnessTaskIndex({projectRoot: root});
  const ids = listedTaskIds(tasks);
  const unindexedTasks = ids.filter(id => !index.records.has(id));
  const records = [...index.records.values()].map(recordFromIndex);
  const eventsByTask = readAllHarnessEvents({projectRoot: root, taskIds: records.map(record => record.id)});
  const health = {
    complete: index.invalidIndexEntries === 0 && unindexedTasks.length === 0,
    invalidIndexEntries: index.invalidIndexEntries,
    unindexedTasks,
    timedOutRecords: []
  };
  return {schemaVersion: 1, projectRoot: root, health, summary: summarize(records, eventsByTask, readMetrics(directory))};
}

async function readTaskForIndex(file, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const content = await fs.promises.readFile(file, {encoding: "utf8", signal: controller.signal});
    const task = JSON.parse(content);
    const id = path.basename(file, ".json");
    if (!task || typeof task !== "object" || Array.isArray(task) || task.id !== id || !Array.isArray(task.outcomes)) {
      return {status: "invalid", id};
    }
    task.outcomes.forEach(assertOutcome);
    return {status: "ok", id, record: buildTaskIndexRecord(task)};
  } catch (error) {
    const id = path.basename(file, ".json");
    return {status: error?.name === "AbortError" ? "timeout" : "invalid", id};
  } finally {
    clearTimeout(timer);
  }
}

export async function rebuildHarnessIndex({projectRoot, concurrency = 8, perFileTimeoutMs = 500, totalTimeoutMs = 10000}) {
  const root = buildProfile({projectRoot}).projectRoot;
  const directory = existingSafeDirectory(root, HARNESS_DIRECTORY);
  const tasks = directory && existingSafeDirectory(root, path.posix.join(HARNESS_DIRECTORY, "tasks"));
  if (!directory || !tasks) throw new Error("missing task harness");
  const entries = fs.readdirSync(tasks, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name));
  const files = entries.filter(entry => entry.isFile() && !entry.isSymbolicLink() && path.extname(entry.name) === ".json")
    .map(entry => path.join(tasks, entry.name));
  const invalidRecords = entries.filter(entry => entry.isSymbolicLink() || !entry.isFile() || path.extname(entry.name) !== ".json")
    .map(entry => entry.name);
  const timedOutRecords = [];
  const records = [];
  const deadline = Date.now() + totalTimeoutMs;
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++;
      const file = files[index];
      const id = path.basename(file, ".json");
      if (Date.now() >= deadline) {
        timedOutRecords.push(id);
        continue;
      }
      const result = await readTaskForIndex(file, Math.min(perFileTimeoutMs, Math.max(1, deadline - Date.now())));
      if (result.status === "ok") records.push(result.record);
      else if (result.status === "timeout") timedOutRecords.push(result.id);
      else invalidRecords.push(result.id);
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, Math.max(1, files.length))}, worker));
  records.sort((left, right) => left.taskId.localeCompare(right.taskId));
  invalidRecords.sort();
  timedOutRecords.sort();
  const destination = path.join(directory, TASK_INDEX_FILENAME);
  const temporary = path.join(directory, `.${TASK_INDEX_FILENAME}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, records.map(record => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), {mode: 0o600});
  fs.renameSync(temporary, destination);
  return {indexedTaskCount: records.length, invalidRecords, timedOutRecords, complete: invalidRecords.length === 0 && timedOutRecords.length === 0};
}

function formatPercentage(value) {
  return value === null ? "未采集" : `${Math.round(value * 100)}%`;
}

function formatNumber(value) {
  return value === null ? "未采集" : String(value);
}

export function formatEvaluation(result, format = "json") {
  if (!result || typeof result !== "object" || !result.summary) throw new Error("invalid evaluation result");
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  if (format !== "markdown") throw new Error("invalid format");
  const summary = result.summary;
  const blockers = Object.keys(summary.blockerCategories).length === 0
    ? "无已分类阻塞"
    : Object.entries(summary.blockerCategories).map(([category, count]) => `${category}: ${count}`).join("；");
  return [
    "# Harness 交付评估",
    "",
    `- 索引完整：${result.health?.complete === false ? "否" : "是"}；无效索引 ${result.health?.invalidIndexEntries ?? 0}；未索引任务 ${(result.health?.unindexedTasks ?? []).length}；超时记录 ${(result.health?.timedOutRecords ?? []).length}。`,
    `- 任务：${summary.taskCount} 个；已有结果：${summary.terminalTaskCount} 个。`,
    `- 完成且验证通过：${summary.completedPassedCount} 个。`,
    `- 一次通过率：${formatPercentage(summary.firstPassRate)}（${summary.firstPassCompletedCount}/${summary.terminalTaskCount}；唯一结果为完成、验证通过且返工为 0）。`,
    `- 平均澄清轮次：${formatNumber(summary.averageClarificationRounds)}；平均返工次数：${formatNumber(summary.averageReworkCount)}。`,
    `- 验证耗时覆盖率：${formatPercentage(summary.verificationDurationCoverage)}；已记录样本平均验证耗时：${formatNumber(summary.averageVerificationDurationSeconds)} 秒。`,
    `- 阻塞分类：${blockers}。`,
    `- Observation 样本：${summary.observations.sampleSize}；返回字节比：${formatPercentage(summary.observations.returnedByteRatio)}（${summary.observations.returnedBytes}/${summary.observations.fullBytes}）。`,
    `- 回查率：${formatPercentage(summary.observations.recallRate)}（${summary.observations.recallCount}/${summary.observations.sampleSize}）；归档失败率：${formatPercentage(summary.observations.archiveFailureRate)}（${summary.observations.archiveFailureCount}/${summary.observations.sampleSize}）。`,
    `- verifier 结果一致率：${formatPercentage(summary.observations.verifierResultConsistencyRate)}（${summary.observations.consistentVerifierCount}/${summary.observations.consistencySampleSize}；仅统计重复运行的 verifier）。`,
    `- 方法采用率：${formatPercentage(summary.reasoningMethods.adoptionRate)}；选择 ${summary.reasoningMethods.selectedCount} 次，完成 ${summary.reasoningMethods.completedCount} 次，组合任务 ${summary.reasoningMethods.combinationTaskCount} 个。`,
    "",
    "说明：本报告只读取已记录的任务证据，不执行记录中的任何命令。历史任务缺少耗时或阻塞分类时会降低覆盖率，不能据此推断实际速度。"
  ].join("\n");
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {format: "json"};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--task-id", "--format"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--all") {
      options.all = true;
    } else if (argument === "--rebuild-index") {
      options.rebuildIndex = true;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.project) throw new Error("--project requires a value");
  if (!new Set(["json", "markdown"]).has(options.format)) throw new Error("invalid format");
  const scopes = Number(Boolean(options["task-id"])) + Number(Boolean(options.all)) + Number(Boolean(options.rebuildIndex));
  if (scopes !== 1) throw new Error("use --task-id or --all or --rebuild-index");
  return options;
}

function formatUsage() {
  return [
    "用法：harness-evaluate.mjs --project <项目目录> (--task-id <任务 ID> | --all | --rebuild-index) [--format json|markdown]",
    "",
    "只读汇总已记录的 Harness 任务证据；不会执行账本中的验证命令或写入项目。"
  ].join("\n");
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${formatUsage()}\n`);
    return;
  }
  if (options.rebuildIndex) {
    const result = await rebuildHarnessIndex({projectRoot: options.project});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.complete) process.exitCode = 2;
    return;
  }
  const result = evaluateHarness({projectRoot: options.project, taskId: options["task-id"], all: options.all});
  process.stdout.write(formatEvaluation(result, options.format));
  if (result.health?.complete === false) process.exitCode = 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`harness evaluation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
