import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildProfile} from "./profile-project.mjs";
import {HARNESS_DIRECTORY} from "./harness-project.mjs";

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

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function average(values) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function summarize(records) {
  const terminal = records.filter(record => record.outcomes.length > 0).map(record => ({...record, outcome: record.outcomes.at(-1)}));
  const completedPassed = terminal.filter(record => record.outcome.status === "completed" && record.outcome.verification.status === "passed");
  const firstPass = completedPassed.filter(record => record.outcomes.length === 1 && record.outcome.reworkCount === 0);
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
    blockerCategories
  };
}

export function evaluateHarness({projectRoot}) {
  const root = buildProfile({projectRoot}).projectRoot;
  const directory = existingSafeDirectory(root, HARNESS_DIRECTORY);
  if (!directory) throw new Error("missing task harness");
  const tasks = existingSafeDirectory(root, path.posix.join(HARNESS_DIRECTORY, "tasks"));
  if (!tasks) throw new Error("missing task harness");
  return {schemaVersion: 1, projectRoot: root, summary: summarize(readTaskRecords(tasks))};
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
    `- 任务：${summary.taskCount} 个；已有结果：${summary.terminalTaskCount} 个。`,
    `- 完成且验证通过：${summary.completedPassedCount} 个。`,
    `- 一次通过率：${formatPercentage(summary.firstPassRate)}（${summary.firstPassCompletedCount}/${summary.terminalTaskCount}；唯一结果为完成、验证通过且返工为 0）。`,
    `- 平均澄清轮次：${formatNumber(summary.averageClarificationRounds)}；平均返工次数：${formatNumber(summary.averageReworkCount)}。`,
    `- 验证耗时覆盖率：${formatPercentage(summary.verificationDurationCoverage)}；已记录样本平均验证耗时：${formatNumber(summary.averageVerificationDurationSeconds)} 秒。`,
    `- 阻塞分类：${blockers}。`,
    "",
    "说明：本报告只读取已记录的任务证据，不执行记录中的任何命令。历史任务缺少耗时或阻塞分类时会降低覆盖率，不能据此推断实际速度。"
  ].join("\n");
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {format: "json"};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project" || argument === "--format") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.project) throw new Error("--project requires a value");
  if (!new Set(["json", "markdown"]).has(options.format)) throw new Error("invalid format");
  return options;
}

function formatUsage() {
  return [
    "用法：harness-evaluate.mjs --project <项目目录> [--format json|markdown]",
    "",
    "只读汇总已记录的 Harness 任务证据；不会执行账本中的验证命令或写入项目。"
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${formatUsage()}\n`);
    return;
  }
  process.stdout.write(formatEvaluation(evaluateHarness({projectRoot: options.project}), options.format));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness evaluation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
