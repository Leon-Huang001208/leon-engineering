import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {appendHarnessEvent, startHarnessSession} from "./harness-project.mjs";
import {verifyHarnessRuntime} from "./harness-runtime.mjs";

const RUNTIME_PATH = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(RUNTIME_PATH, ".leon-engineering-harness-runtime.json");
const WRITE_TOOLS = new Set(["apply_patch", "Edit", "Write", "MultiEdit"]);
const MUTATING_EXECUTABLES = new Set(["apply_patch", "chmod", "chown", "cp", "install", "mkdir", "mv", "rm", "tee", "touch"]);
const MUTATING_GIT_ACTIONS = new Set([
  "add", "am", "apply", "bisect", "checkout", "cherry-pick", "clean", "clone", "commit", "fetch", "gc", "init", "merge",
  "mv", "notes", "pull", "push", "rebase", "reflog", "remote", "reset", "restore", "revert", "rm", "stash", "switch", "tag"
]);
const READ_ONLY_GIT_ACTIONS = new Set(["cat-file", "diff", "log", "ls-files", "ls-tree", "merge-base", "name-rev", "rev-parse", "show", "show-ref", "status"]);

function projectRoot(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  try {
    let candidate = fs.realpathSync(cwd);
    if (!fs.statSync(candidate).isDirectory()) return null;
    let instructionRoot = null;
    while (true) {
      if (fs.existsSync(path.join(candidate, ".git")) || fs.existsSync(path.join(candidate, ".ai", "harness"))) return candidate;
      if (!instructionRoot && (fs.existsSync(path.join(candidate, "AGENTS.md")) || fs.existsSync(path.join(candidate, "CLAUDE.md")))) {
        instructionRoot = candidate;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) return instructionRoot;
      candidate = parent;
    }
  } catch {
    return null;
  }
}

function opaqueSessionId(input, host) {
  const sessionId = input.session_id ?? (host === "claude" ? process.env.CLAUDE_SESSION_ID : process.env.CODEX_SESSION_ID);
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(sessionId)) return null;
  return sessionId;
}

function toolCategory(name) {
  if (name === "Bash") return "shell";
  if (["apply_patch", "Edit", "Write", "MultiEdit"].includes(name)) return "write";
  if (name === "Read") return "read";
  return "other";
}

function tokenizeShell(command) {
  if (typeof command !== "string" || command.trim().length === 0 || command.length > 4096) return null;
  if (/[\r\n;&|`]/.test(command) || /\$\(|\$\{/.test(command) || command.includes("\\")) return null;
  const words = [];
  let word = "";
  let quote = null;
  for (const character of command.trim()) {
    if (quote) {
      if (character === quote) quote = null;
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (word) words.push(word);
      word = "";
    } else {
      word += character;
    }
  }
  if (quote) return null;
  if (word) words.push(word);
  return words;
}

function shellCommand(input) {
  return input?.tool_input?.command ?? input?.tool_input?.cmd;
}

function classifyGit(words) {
  let index = 1;
  if (words[index] === "--no-pager") index += 1;
  if (words[index] === "-C") index += 2;
  const action = words[index];
  if (!action) return "unknown";
  if (MUTATING_GIT_ACTIONS.has(action)) {
    if (action === "remote" && [undefined, "-v", "get-url"].includes(words[index + 1])) return "diagnostic_read";
    return "mutation";
  }
  if (action === "worktree") return words[index + 1] === "list" ? "diagnostic_read" : "mutation";
  if (action === "branch") {
    return words.slice(index + 1).every(word => ["--show-current", "--list", "-a", "-r", "-v", "-vv"].includes(word))
      ? "diagnostic_read"
      : "mutation";
  }
  if (!READ_ONLY_GIT_ACTIONS.has(action)) return "unknown";
  const unsafe = words.slice(index + 1).some(word => ["--ext-diff", "--textconv", "--filters", "--output", "--paginate"].includes(word) || word.startsWith("--output="));
  return unsafe ? "unknown" : "diagnostic_read";
}

function classifyShell(command) {
  if (typeof command !== "string" || command.trim().length === 0) return "unknown";
  if (/[<>]/.test(command)) return "mutation";
  const words = tokenizeShell(command);
  if (!words?.length) return "unknown";
  const executable = path.basename(words[0]);
  if (MUTATING_EXECUTABLES.has(executable)) return "mutation";
  if (executable === "git") return classifyGit(words);
  if (["npm", "pnpm", "yarn", "pip", "pip3", "brew"].includes(executable) && words.slice(1).some(word => ["add", "i", "install", "uninstall", "update", "upgrade"].includes(word))) return "mutation";
  if (["python", "python3"].includes(executable) && words[1] === "-m" && ["pip", "pip3"].includes(words[2]) && words.slice(3).some(word => ["install", "uninstall"].includes(word))) return "mutation";
  if (executable === "node" && (path.basename(words[1] ?? "").startsWith("install-") || words.includes("--install") || words.includes("--install-global"))) return "mutation";
  if (executable === "pwd") return words.slice(1).every(word => word === "-L" || word === "-P") ? "diagnostic_read" : "unknown";
  if (executable === "sed") {
    if (words.some(word => word === "-i" || word.startsWith("-i") || word === "--in-place" || word.startsWith("--in-place="))) return "mutation";
    const operands = words[3] === "--" ? words.slice(4) : words.slice(3);
    return words[1] === "-n"
      && /^\d+(,\d+)?p$/.test(words[2] ?? "")
      && operands.length > 0
      && operands.every(word => !word.startsWith("-"))
      ? "diagnostic_read"
      : "unknown";
  }
  if (executable === "rg") {
    const unsafe = words.slice(1).some(word => word === "--pre" || word.startsWith("--pre=") || word === "--hostname-bin" || word.startsWith("--hostname-bin="));
    return unsafe ? "unknown" : "diagnostic_read";
  }
  if (executable === "node" && path.resolve(words[1] ?? "") === path.join(RUNTIME_PATH, "harness-runtime.mjs")) {
    const args = words.slice(2);
    if (args.length === 1 && args[0] === "--verify") return "diagnostic_read";
    if (args.length === 3 && args[0] === "--verify" && args[1] === "--runtime-root" && path.resolve(args[2]) === RUNTIME_PATH) return "diagnostic_read";
  }
  return "unknown";
}

export function classifyHookCommand(input) {
  if (input?.tool_name === "Read") return "diagnostic_read";
  if (WRITE_TOOLS.has(input?.tool_name)) return "mutation";
  if (input?.tool_name === "Bash") return classifyShell(shellCommand(input));
  return "unknown";
}

function sourceRuntime() {
  return path.basename(RUNTIME_PATH) === "scripts" && fs.existsSync(path.join(RUNTIME_PATH, "..", ".claude-plugin", "plugin.json"));
}

function verifyManagedRuntime() {
  if (sourceRuntime()) return;
  const verification = verifyHarnessRuntime({sourceRoot: null, runtimeRoot: RUNTIME_PATH});
  if (verification.valid) return;
  const error = new Error(`runtime integrity check failed: ${verification.drift.join(", ")}`);
  error.code = verification.drift.includes("missing runtime manifest") ? "HARNESS_RUNTIME_MISSING" : "HARNESS_RUNTIME_DRIFT";
  throw error;
}

function sanitizeErrorMessage(error) {
  return String(error?.message || "unknown initialization error")
    .replace(/\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]+\b/gi, "[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

function diagnosticCode(error, stage) {
  if (error?.code === "HARNESS_SESSION_ID_MISSING") return "missing_session_id";
  if (error?.code === "HARNESS_RUNTIME_MISSING" || (stage === "runtime_verify" && error?.code === "ENOENT")) return "runtime_missing";
  if (error?.code === "HARNESS_RUNTIME_DRIFT" || /runtime manifest|runtime integrity/i.test(error?.message ?? "")) return "manifest_drift";
  if (["EACCES", "EPERM"].includes(error?.code)) return "permission_denied";
  if (/invalid harness session/i.test(error?.message ?? "")) return "invalid_session_state";
  if (/(?:harness )?task record/i.test(error?.message ?? "")) return "invalid_task_state";
  if (stage === "event_record") return "event_record_failed";
  return "initialization_failed";
}

function initializationDiagnostic(error, stage) {
  return {
    stage,
    code: diagnosticCode(error, stage),
    message: sanitizeErrorMessage(error),
    runtimePath: RUNTIME_PATH,
    manifestPath: MANIFEST_PATH,
    recoveryCommand: `node "${path.join(RUNTIME_PATH, "harness-runtime.mjs")}" --verify --runtime-root "${RUNTIME_PATH}"`
  };
}

function diagnosticReason(diagnostic, classification) {
  return [
    `Harness initialization failed`,
    `classification=${classification}`,
    `stage=${diagnostic.stage}`,
    `code=${diagnostic.code}`,
    `message=${diagnostic.message}`,
    `runtime=${diagnostic.runtimePath}`,
    `manifest=${diagnostic.manifestPath}`,
    `recovery=${diagnostic.recoveryCommand}`
  ].join("; ");
}

function initializationFailure({phase, input, error, stage}) {
  if (phase === "post") return {decision: "allow", skipped: true};
  const classification = classifyHookCommand(input);
  const diagnostic = initializationDiagnostic(error, stage);
  const result = {classification, diagnostic, reason: diagnosticReason(diagnostic, classification)};
  return classification === "diagnostic_read"
    ? {decision: "allow", degraded: true, ...result}
    : {decision: "deny", ...result};
}

function taskIdFor(host, sessionId) {
  return `task-${crypto.createHash("sha256").update(`${host}:${sessionId}`).digest("hex").slice(0, 20)}`;
}

export function handleHarnessHook({
  phase,
  input,
  host = "claude",
  runtimeVerifier = verifyManagedRuntime,
  sessionStarter = startHarnessSession,
  eventAppender = appendHarnessEvent
}) {
  if (!new Set(["pre", "post"]).has(phase)) throw new Error("invalid harness hook phase");
  if (!new Set(["claude", "codex"]).has(host)) throw new Error("invalid harness hook host");
  const root = projectRoot(input?.cwd);
  if (!root) return {decision: "allow", skipped: true};
  let stage = "runtime_verify";
  try {
    runtimeVerifier();
    stage = "session_identity";
    const sessionId = opaqueSessionId(input ?? {}, host);
    if (!sessionId) {
      const error = new Error(`Harness requires an opaque ${host === "claude" ? "Claude Code" : "Codex"} session id.`);
      error.code = "HARNESS_SESSION_ID_MISSING";
      throw error;
    }
    const taskId = taskIdFor(host, sessionId);
    stage = "session_start";
    const session = sessionStarter({
      projectRoot: root,
      host,
      sessionId,
      task: {
        id: taskId,
        goal: `${host === "claude" ? "Claude Code" : "Codex"} 受管项目任务`,
        acceptanceCriteria: ["Harness 记录完整且验证结果已写入"]
      }
    });
    stage = "event_record";
    eventAppender({
      projectRoot: root,
      taskId: session.taskId,
      event: phase === "pre"
        ? {event: "policy_decision", host, tool: toolCategory(input?.tool_name), decision: "allow"}
        : {event: "tool_completed", host, tool: toolCategory(input?.tool_name)}
    });
    return {decision: "allow", taskId: session.taskId};
  } catch (error) {
    return initializationFailure({phase, input, error, stage});
  }
}

function parseArgs(args) {
  if (args.length < 2 || args[0] !== "--phase" || !["pre", "post"].includes(args[1])) {
    throw new Error("use --phase pre|post [--host claude|codex]");
  }
  if (args.length === 2) return {phase: args[1], host: "claude"};
  if (args.length === 4 && args[2] === "--host" && ["claude", "codex"].includes(args[3])) return {phase: args[1], host: args[3]};
  throw new Error("use --phase pre|post [--host claude|codex]");
}

async function main(args) {
  const {phase, host} = parseArgs(args);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    input = {};
  }
  const result = handleHarnessHook({phase, input, host});
  if (phase === "pre" && (result.decision === "deny" || result.degraded)) {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason
    }}));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Harness hook failed; project mutation is blocked."
    }}));
  });
}
