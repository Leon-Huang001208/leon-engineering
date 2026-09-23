import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {fileURLToPath} from "node:url";

const TOOL_CALL_TYPES = new Set(["custom_tool_call", "function_call", "local_shell_call", "web_search_call"]);
const TOOL_OUTPUT_TYPES = new Set(["custom_tool_call_output", "function_call_output", "local_shell_call_output"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function normalizedArguments(input) {
  if (typeof input !== "string") return JSON.stringify(stableValue(input ?? null));
  try {
    return JSON.stringify(stableValue(JSON.parse(input)));
  } catch {
    return input.trim().replace(/\s+/g, " ");
  }
}

function toolCategory(name) {
  const value = String(name ?? "unknown").toLowerCase();
  if (/(?:exec|shell|bash|command|terminal)/.test(value)) return "shell";
  if (/(?:read|open|find|search|grep|rg)/.test(value)) return "read";
  if (/(?:write|edit|patch|apply)/.test(value)) return "write";
  if (/(?:browser|playwright|web|screenshot)/.test(value)) return "browser";
  if (/(?:git|github)/.test(value)) return "git";
  return "other";
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function outputBytes(output) {
  if (Buffer.isBuffer(output)) return output.length;
  if (typeof output === "string") return Buffer.byteLength(output);
  if (output === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(output));
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function newAggregate() {
  return {
    counts: {sessions: 0, turns: 0, modelCalls: 0, toolCalls: 0},
    tokens: {input: 0, cachedInput: 0, nonCachedInput: 0, output: 0, reasoning: 0, total: 0},
    turns: new Set(),
    toolOutputs: [],
    calls: new Map(),
    categories: new Map(),
    files: [],
    errors: []
  };
}

function accumulateRecord(aggregate, record) {
  const payload = record?.payload;
  if (record?.type === "turn_context" && typeof payload?.turn_id === "string") {
    aggregate.turns.add(payload.turn_id);
  }
  if (record?.type === "token_usage_record") {
    aggregate.counts.modelCalls += 1;
    if (typeof payload?.turn_id === "string") aggregate.turns.add(payload.turn_id);
    const usage = payload?.usage ?? {};
    const input = nonNegativeNumber(usage.input_tokens);
    const cached = nonNegativeNumber(usage.cached_input_tokens);
    aggregate.tokens.input += input;
    aggregate.tokens.cachedInput += cached;
    aggregate.tokens.nonCachedInput += Math.max(0, input - cached);
    aggregate.tokens.output += nonNegativeNumber(usage.output_tokens);
    aggregate.tokens.reasoning += nonNegativeNumber(usage.reasoning_output_tokens);
    aggregate.tokens.total += nonNegativeNumber(usage.total_tokens);
  }
  if (record?.type !== "response_item" || !payload || typeof payload !== "object") return;
  if (TOOL_CALL_TYPES.has(payload.type)) {
    aggregate.counts.toolCalls += 1;
    const name = String(payload.name ?? payload.tool_name ?? payload.type);
    const category = toolCategory(name);
    aggregate.categories.set(category, (aggregate.categories.get(category) ?? 0) + 1);
    const fingerprint = crypto.createHash("sha256")
      .update(name)
      .update("\0")
      .update(normalizedArguments(payload.input ?? payload.arguments ?? payload.action ?? null))
      .digest("hex");
    const existing = aggregate.calls.get(fingerprint) ?? {fingerprint, category, count: 0};
    existing.count += 1;
    aggregate.calls.set(fingerprint, existing);
  } else if (TOOL_OUTPUT_TYPES.has(payload.type)) {
    aggregate.toolOutputs.push(outputBytes(payload.output));
  }
}

async function auditFile(file, ordinal, aggregate) {
  const absolute = fs.realpathSync(file);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("invalid session file");
  if (absolute !== fs.realpathSync(file)) throw new Error("invalid session file");
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  stream.on("data", chunk => hash.update(chunk));
  const lines = readline.createInterface({input: stream, crlfDelay: Infinity});
  let lineNumber = 0;
  let recordCount = 0;
  let malformedLines = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      recordCount += 1;
      accumulateRecord(aggregate, record);
    } catch {
      malformedLines += 1;
      aggregate.errors.push({fileOrdinal: ordinal, code: "malformed_jsonl", line: lineNumber});
    }
  }
  aggregate.files.push({fileOrdinal: ordinal, sha256: hash.digest("hex"), records: recordCount, malformedLines});
}

export async function auditSessionFiles({files}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("at least one session file is required");
  const aggregate = newAggregate();
  aggregate.counts.sessions = files.length;
  for (let index = 0; index < files.length; index += 1) {
    try {
      await auditFile(files[index], index + 1, aggregate);
    } catch {
      aggregate.errors.push({fileOrdinal: index + 1, code: "unreadable_session"});
      aggregate.files.push({fileOrdinal: index + 1, sha256: null, records: 0, malformedLines: 0});
    }
  }
  aggregate.counts.turns = aggregate.turns.size;
  const repeatedCalls = [...aggregate.calls.values()]
    .filter(item => item.count > 1)
    .sort((left, right) => right.count - left.count || left.fingerprint.localeCompare(right.fingerprint));
  return {
    schemaVersion: 1,
    complete: aggregate.errors.length === 0,
    counts: aggregate.counts,
    tokens: aggregate.tokens,
    toolOutput: {
      count: aggregate.toolOutputs.length,
      totalBytes: aggregate.toolOutputs.reduce((total, value) => total + value, 0),
      p50Bytes: percentile(aggregate.toolOutputs, 0.5),
      p95Bytes: percentile(aggregate.toolOutputs, 0.95),
      maxBytes: percentile(aggregate.toolOutputs, 1)
    },
    repeatedCalls,
    toolCategories: Object.fromEntries([...aggregate.categories].sort(([left], [right]) => left.localeCompare(right))),
    files: aggregate.files,
    errors: aggregate.errors
  };
}

function assertThreadId(threadId) {
  if (typeof threadId !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(threadId)) {
    throw new Error("invalid thread id");
  }
  return threadId;
}

async function fileHasThreadId(file, threadId) {
  const stream = fs.createReadStream(file);
  const lines = readline.createInterface({input: stream, crlfDelay: Infinity});
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.payload?.thread_id === threadId) return true;
    } catch {
      // The selected audit reports malformed lines; discovery does not turn them into content.
    }
  }
  return false;
}

export async function findThreadSessions({threadId, sessionRoot}) {
  const selectedThread = assertThreadId(threadId);
  if (typeof sessionRoot !== "string" || sessionRoot.length === 0) throw new Error("session root is required");
  const rootStat = fs.lstatSync(sessionRoot);
  if (rootStat.isSymbolicLink()) throw new Error("session root cannot be a symbolic link");
  if (!rootStat.isDirectory()) throw new Error("invalid session root");
  const root = fs.realpathSync(sessionRoot);
  const files = [];

  async function visit(directory) {
    const entries = fs.readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error("session tree contains a symbolic link");
      if (stat.isDirectory()) await visit(candidate);
      else if (stat.isFile() && path.extname(entry.name) === ".jsonl" && await fileHasThreadId(candidate, selectedThread)) {
        files.push(fs.realpathSync(candidate));
      } else if (!stat.isFile() && !stat.isDirectory()) {
        throw new Error("session tree contains an unsupported entry");
      }
    }
  }

  await visit(root);
  if (files.length === 0) throw new Error("thread session not found");
  return files.sort();
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {};
  const valued = new Set(["--session-jsonl", "--thread-id", "--session-root", "--output"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!valued.has(argument)) throw new Error(`unknown option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  const explicitFile = Boolean(options.session_jsonl);
  const explicitThread = Boolean(options.thread_id || options.session_root);
  if (explicitFile === explicitThread) throw new Error("select one session file or one thread");
  if (explicitThread && (!options.thread_id || !options.session_root)) {
    throw new Error("thread selection requires --thread-id and --session-root");
  }
  return options;
}

function usage() {
  return [
    "Usage: token-audit.mjs --session-jsonl <file> [--output <absolute-file>]",
    "       token-audit.mjs --thread-id <id> --session-root <directory> [--output <absolute-file>]",
    "",
    "Outputs counts, token totals, hashed repeated calls, output-byte percentiles, and source hashes only."
  ].join("\n");
}

function writePrivateReport(destination, report) {
  if (!path.isAbsolute(destination)) throw new Error("output path must be absolute");
  const parent = path.dirname(destination);
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error("invalid output directory");
  if (fs.existsSync(destination)) throw new Error("output file already exists");
  const temporary = path.join(parent, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function boundedReport(report) {
  const full = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(full) <= 4096) return full;
  const sourceSetSha256 = crypto.createHash("sha256")
    .update(report.files.map(file => file.sha256 ?? `error:${file.fileOrdinal}`).join("\0"))
    .digest("hex");
  const summary = {
    schemaVersion: report.schemaVersion,
    complete: report.complete,
    counts: report.counts,
    tokens: report.tokens,
    toolOutput: report.toolOutput,
    repeatedCallGroups: report.repeatedCalls.length,
    toolCategories: report.toolCategories,
    fileCount: report.files.length,
    errorCount: report.errors.length,
    errors: report.errors.slice(0, 20),
    sourceSetSha256,
    fullReport: "use --output with an absolute private path"
  };
  const rendered = `${JSON.stringify(summary)}\n`;
  if (Buffer.byteLength(rendered) > 4096) throw new Error("bounded report overflow");
  return rendered;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const files = options.session_jsonl
    ? [options.session_jsonl]
    : await findThreadSessions({threadId: options.thread_id, sessionRoot: options.session_root});
  const report = await auditSessionFiles({files});
  if (options.output) writePrivateReport(options.output, report);
  process.stdout.write(boundedReport(report));
  if (!report.complete) process.exitCode = 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`token audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
