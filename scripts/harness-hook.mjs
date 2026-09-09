import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {appendHarnessEvent, startHarnessSession} from "./harness-project.mjs";
import {defaultHarnessRuntimeRoot, verifyHarnessRuntime} from "./harness-runtime.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_RUNTIME = path.basename(MODULE_DIRECTORY) === "scripts"
  && fs.existsSync(path.join(MODULE_DIRECTORY, "..", ".claude-plugin", "plugin.json"));
const RUNTIME_PATH = SOURCE_RUNTIME ? defaultHarnessRuntimeRoot() : MODULE_DIRECTORY;
const MANIFEST_PATH = path.join(RUNTIME_PATH, ".leon-engineering-harness-runtime.json");
const SHELL_TOOLS = new Set(["Bash", "Shell", "exec_command", "shell_command"]);
const READ_TOOLS = new Set(["Read", "read_file"]);
const MUTATION_TOOLS = new Set(["apply_patch", "Edit", "Write", "MultiEdit", "NotebookEdit", "write_stdin"]);
const MUTATING_EXECUTABLES = new Set(["apply_patch", "chmod", "chown", "cp", "install", "mkdir", "mv", "rm", "tee", "touch", "truncate"]);
const MUTATING_GIT_ACTIONS = new Set([
  "add", "am", "apply", "bisect", "checkout", "cherry-pick", "clean", "clone", "commit", "fetch", "gc", "init", "merge",
  "mv", "notes", "pull", "push", "rebase", "reflog", "reset", "restore", "revert", "rm", "stash", "switch"
]);
const READ_ONLY_GIT_ACTIONS = new Set([
  "cat-file", "describe", "diff", "log", "ls-files", "ls-remote", "ls-tree", "merge-base", "name-rev", "rev-parse", "show", "show-ref", "status"
]);

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
  if (SHELL_TOOLS.has(name)) return "shell";
  if (MUTATION_TOOLS.has(name)) return "write";
  if (READ_TOOLS.has(name)) return "read";
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

function gitAction(words) {
  let index = 1;
  while (index < words.length) {
    if (["-C", "--git-dir", "--work-tree", "--namespace"].includes(words[index])) {
      index += 2;
      continue;
    }
    if (/^--(?:git-dir|work-tree|namespace)=/.test(words[index]) || ["--no-pager", "--literal-pathspecs", "--no-optional-locks"].includes(words[index])) {
      index += 1;
      continue;
    }
    return {action: words[index], args: words.slice(index + 1)};
  }
  return {action: null, args: []};
}

function classifyGit(words) {
  const {action, args} = gitAction(words);
  if (!action) return "unknown";
  if (MUTATING_GIT_ACTIONS.has(action)) return "mutation";
  if (action === "remote") return args.length === 0 || args[0] === "-v" || ["get-url", "show"].includes(args[0]) ? "diagnostic_read" : "mutation";
  if (action === "worktree") return args[0] === "list" ? "diagnostic_read" : "mutation";
  if (action === "branch") {
    if (args.length === 0) return "diagnostic_read";
    return ["--all", "-a", "--contains", "--list", "-l", "--merged", "--no-contains", "--no-merged", "--points-at", "--remotes", "-r", "--show-current", "-v", "-vv"].includes(args[0]) ? "diagnostic_read" : "mutation";
  }
  if (action === "symbolic-ref") return args.filter(argument => !["-q", "--quiet", "--short"].includes(argument)).length === 1 ? "diagnostic_read" : "mutation";
  if (action === "tag") return args.length === 0 || args[0] === "--list" || args[0] === "-l" ? "diagnostic_read" : "mutation";
  if (action === "config") return args.some(argument => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(argument)) ? "diagnostic_read" : "mutation";
  if (!READ_ONLY_GIT_ACTIONS.has(action)) return "unknown";
  const unsafe = args.some(word => ["--ext-diff", "--textconv", "--filters", "--output", "--paginate"].includes(word) || word.startsWith("--output="));
  return unsafe ? "unknown" : "diagnostic_read";
}

function resolvedRuntimePath(word) {
  if (typeof word !== "string" || word.length === 0) return null;
  let candidate = word;
  if (candidate.startsWith("$HOME/")) candidate = path.join(os.homedir(), candidate.slice(6));
  else if (candidate.startsWith("${HOME}/")) candidate = path.join(os.homedir(), candidate.slice(8));
  else if (candidate.startsWith("~/")) candidate = path.join(os.homedir(), candidate.slice(2));
  return path.resolve(candidate);
}

function isManagedRuntimeVerify(words) {
  if (path.basename(words[0] ?? "") !== "node") return false;
  const script = resolvedRuntimePath(words[1]);
  if (!new Set([
    path.join(RUNTIME_PATH, "harness-runtime.mjs"),
    path.join(defaultHarnessRuntimeRoot(), "harness-runtime.mjs")
  ]).has(script)) return false;
  const args = words.slice(2);
  if (args.length === 1 && args[0] === "--verify") return true;
  return args.length === 3
    && args[0] === "--verify"
    && args[1] === "--runtime-root"
    && resolvedRuntimePath(args[2]) === path.dirname(script);
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
  return isManagedRuntimeVerify(words) ? "diagnostic_read" : "unknown";
}

export function classifyHookCommand(input) {
  if (READ_TOOLS.has(input?.tool_name)) return "diagnostic_read";
  if (MUTATION_TOOLS.has(input?.tool_name)) return "mutation";
  if (SHELL_TOOLS.has(input?.tool_name)) return classifyShell(shellCommand(input));
  return "unknown";
}

export const classifyHookOperation = classifyHookCommand;

function sourceRuntime() {
  return SOURCE_RUNTIME;
}

function verifyManagedRuntime() {
  if (sourceRuntime()) return;
  const verification = verifyHarnessRuntime({runtimeRoot: RUNTIME_PATH});
  if (verification.valid) return;
  const error = new Error("runtime integrity check failed");
  error.code = verification.drift.some(item => ["missing runtime directory", "missing runtime manifest"].includes(item))
    ? "HARNESS_RUNTIME_MISSING"
    : "HARNESS_RUNTIME_DRIFT";
  throw error;
}

function diagnosticCode(error, stage) {
  if (error?.code === "HARNESS_SESSION_ID_MISSING") return "missing_session_id";
  if (error?.code === "HARNESS_RUNTIME_MISSING" || (stage === "runtime_verify" && error?.code === "ENOENT")) return "runtime_missing";
  if (error?.code === "HARNESS_RUNTIME_DRIFT") return "manifest_drift";
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
    runtimePath: RUNTIME_PATH,
    manifestPath: MANIFEST_PATH,
    recoveryCommand: `node "${path.join(RUNTIME_PATH, "harness-runtime.mjs")}" --verify --runtime-root "${RUNTIME_PATH}"`
  };
}

function diagnosticReason(diagnostic, classification) {
  const prefix = diagnostic.code === "missing_session_id" ? "Harness requires an opaque session id" : "Harness initialization failed";
  return [
    prefix,
    `classification=${classification}`,
    `stage=${diagnostic.stage}`,
    `code=${diagnostic.code}`,
    `runtime=${diagnostic.runtimePath}`,
    `manifest=${diagnostic.manifestPath}`,
    `recovery=${diagnostic.recoveryCommand}`
  ].join("; ");
}

function initializationFailure({phase, input, error, stage}) {
  const classification = classifyHookCommand(input);
  const diagnostic = initializationDiagnostic(error, stage);
  const result = {classification, diagnostic, reason: diagnosticReason(diagnostic, classification)};
  if (phase === "post") return {decision: "allow", skipped: true, degraded: true, ...result};
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
      const error = new Error("missing harness session identity");
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

function logDiagnostic(result) {
  if (!result.diagnostic) return;
  process.stderr.write(`${JSON.stringify({
    component: "harness-hook",
    event: "initialization_failed",
    classification: result.classification,
    decision: result.decision,
    ...result.diagnostic
  })}\n`);
}

function writePreHookDecision(result) {
  if (result.decision !== "deny" && !result.degraded) return;
  process.stdout.write(JSON.stringify({hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: result.decision,
    permissionDecisionReason: result.reason
  }}));
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
    throw new Error("invalid harness hook input");
  }
  const result = handleHarnessHook({phase, input, host});
  logDiagnostic(result);
  if (phase === "pre") writePreHookDecision(result);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    const diagnostic = initializationDiagnostic(error, "hook_protocol");
    const result = {
      decision: "deny",
      classification: "unknown",
      diagnostic,
      reason: diagnosticReason(diagnostic, "unknown")
    };
    logDiagnostic(result);
    writePreHookDecision(result);
  });
}
