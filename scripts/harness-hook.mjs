import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {appendHarnessEvent, startHarnessSession} from "./harness-project.mjs";
import {defaultHarnessRuntimeRoot} from "./harness-runtime.mjs";

const SHELL_TOOLS = new Set(["Bash", "Shell", "exec_command", "shell_command"]);
const READ_TOOLS = new Set(["Read", "read_file"]);
const MUTATION_TOOLS = new Set(["apply_patch", "Edit", "Write", "MultiEdit", "NotebookEdit", "write_stdin"]);
const READ_ONLY_GIT_COMMANDS = new Set([
  "cat-file", "describe", "diff", "log", "ls-files", "ls-remote", "ls-tree", "merge-base", "name-rev", "rev-parse", "show", "show-ref", "status"
]);
const MUTATING_GIT_COMMANDS = new Set([
  "add", "am", "apply", "bisect", "checkout", "cherry-pick", "clean", "clone", "commit", "fetch", "gc", "merge", "mv", "pull", "push", "rebase", "reset", "restore", "revert", "rm", "stash", "switch"
]);

function projectRoot(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  try {
    const root = fs.realpathSync(cwd);
    return fs.statSync(root).isDirectory() ? root : null;
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
  if (["apply_patch", "Edit", "Write", "MultiEdit"].includes(name)) return "write";
  if (READ_TOOLS.has(name)) return "read";
  return "other";
}

function commandText(input) {
  return String(input?.tool_input?.command ?? input?.tool_input?.cmd ?? "").trim();
}

function shellTokens(command) {
  return (command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map(token => {
    if (token.length >= 2 && ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'")))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function commandName(token) {
  return path.basename(token ?? "");
}

function hasShellControl(command) {
  return /[\r\n;&|><`]|\$\(/.test(command);
}

function gitSubcommand(tokens) {
  let index = 1;
  while (index < tokens.length) {
    if (["-C", "--git-dir", "--work-tree", "--namespace"].includes(tokens[index])) {
      index += 2;
      continue;
    }
    if (/^--(?:git-dir|work-tree|namespace)=/.test(tokens[index]) || ["--no-pager", "--literal-pathspecs", "--no-optional-locks"].includes(tokens[index])) {
      index += 1;
      continue;
    }
    return tokens[index];
  }
  return null;
}

function isReadOnlyGit(tokens) {
  const subcommand = gitSubcommand(tokens);
  if (READ_ONLY_GIT_COMMANDS.has(subcommand)) return true;
  const args = tokens.slice(tokens.indexOf(subcommand) + 1);
  if (subcommand === "branch") {
    if (args.length === 0) return true;
    return ["--all", "-a", "--contains", "--list", "-l", "--merged", "--no-contains", "--no-merged", "--points-at", "--remotes", "-r", "--show-current", "-v", "-vv"].includes(args[0]);
  }
  if (subcommand === "remote") return args.length === 0 || args[0] === "-v" || ["show", "get-url"].includes(args[0]);
  if (subcommand === "symbolic-ref") return args.filter(argument => !["-q", "--quiet", "--short"].includes(argument)).length === 1;
  if (subcommand === "worktree") return args[0] === "list";
  if (subcommand === "tag") return args.length === 0 || args[0] === "--list" || args[0] === "-l";
  if (subcommand === "config") return args.some(argument => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(argument));
  return false;
}

function isManagedRuntimeVerify(tokens) {
  if (commandName(tokens[0]) !== "node" || tokens.length < 3) return false;
  let script = tokens[1];
  if (script.startsWith("$HOME/")) script = path.join(os.homedir(), script.slice(6));
  else if (script.startsWith("${HOME}/")) script = path.join(os.homedir(), script.slice(8));
  else if (script.startsWith("~/")) script = path.join(os.homedir(), script.slice(2));
  if (path.resolve(script) !== path.join(defaultHarnessRuntimeRoot(), "harness-runtime.mjs")) return false;
  if (tokens.length === 3) return tokens[2] === "--verify";
  return tokens.length === 5 && tokens[2] === "--verify" && tokens[3] === "--runtime-root" && path.resolve(tokens[4]) === defaultHarnessRuntimeRoot();
}

function isDiagnosticShell(command) {
  if (!command || hasShellControl(command)) return false;
  const tokens = shellTokens(command);
  const name = commandName(tokens[0]);
  if (name === "pwd") return tokens.slice(1).every(argument => ["-L", "-P"].includes(argument));
  if (name === "rg") return !tokens.some(argument => argument === "--pre" || argument.startsWith("--pre="));
  if (name === "sed") {
    if (tokens.length < 4 || tokens[1] !== "-n" || tokens.some(argument => argument === "-i" || argument.startsWith("--in-place") || argument === "-e" || argument === "-f")) return false;
    return /^(?:\d+(?:,\d+)?p|\d+p)$/.test(tokens[2]);
  }
  if (name === "git") return isReadOnlyGit(tokens);
  return isManagedRuntimeVerify(tokens);
}

function isMutationShell(command) {
  if (/[>]/.test(command)) return true;
  const tokens = shellTokens(command);
  const name = commandName(tokens[0]);
  if (["chmod", "chown", "cp", "install", "mkdir", "mv", "rm", "tee", "touch", "truncate"].includes(name)) return true;
  if (name === "sed" && tokens.some(argument => argument === "-i" || argument.startsWith("--in-place"))) return true;
  if (name !== "git") return false;
  const subcommand = gitSubcommand(tokens);
  if (MUTATING_GIT_COMMANDS.has(subcommand)) return true;
  return ["branch", "config", "remote", "symbolic-ref", "tag", "worktree"].includes(subcommand) && !isReadOnlyGit(tokens);
}

export function classifyHookOperation(input) {
  const tool = input?.tool_name ?? "";
  if (READ_TOOLS.has(tool)) return "diagnostic_read";
  if (MUTATION_TOOLS.has(tool)) return "mutation";
  if (!SHELL_TOOLS.has(tool)) return "unknown";
  const command = commandText(input);
  if (isDiagnosticShell(command)) return "diagnostic_read";
  if (isMutationShell(command)) return "mutation";
  return "unknown";
}

function initializationErrorCode(error) {
  const message = String(error?.message ?? "");
  if (message === "invalid harness session") return "HARNESS_SESSION_INVALID";
  if (message.includes("runtime") && message.includes("drift")) return "HARNESS_RUNTIME_DRIFT";
  if (message.includes("manifest")) return "HARNESS_MANIFEST_INVALID";
  return "HARNESS_INITIALIZATION_FAILED";
}

function diagnostics(stage, errorCode) {
  const runtimePath = defaultHarnessRuntimeRoot();
  const manifestPath = path.join(runtimePath, ".leon-engineering-harness-runtime.json");
  return {
    stage,
    errorCode,
    runtimePath,
    manifestPath,
    recovery: `Run node \"${path.join(runtimePath, "harness-runtime.mjs")}\" --verify; if it fails, reinstall from the canonical leon-engineering source before retrying mutations.`
  };
}

function formattedReason(details, operationClass, prefix = "Harness initialization failed") {
  return `${prefix}; stage=${details.stage}; code=${details.errorCode}; operation=${operationClass}; runtime=${details.runtimePath}; manifest=${details.manifestPath}; recovery=${details.recovery}`;
}

function initializationFailure({phase, input, stage, errorCode, prefix}) {
  const operationClass = classifyHookOperation(input);
  const details = diagnostics(stage, errorCode);
  if (phase === "post") return {decision: "allow", skipped: true, degraded: true, operationClass, diagnostics: details};
  const decision = operationClass === "diagnostic_read" ? "allow" : "deny";
  return {
    decision,
    degraded: true,
    operationClass,
    diagnostics: details,
    reason: formattedReason(details, operationClass, prefix)
  };
}

function taskIdFor(host, sessionId) {
  return `task-${crypto.createHash("sha256").update(`${host}:${sessionId}`).digest("hex").slice(0, 20)}`;
}

export function handleHarnessHook({phase, input, host = "claude"}) {
  if (!new Set(["pre", "post"]).has(phase)) throw new Error("invalid harness hook phase");
  if (!new Set(["claude", "codex"]).has(host)) throw new Error("invalid harness hook host");
  const root = projectRoot(input?.cwd);
  if (!root) return {decision: "allow", skipped: true};
  const sessionId = opaqueSessionId(input ?? {}, host);
  if (!sessionId) {
    return initializationFailure({
      phase,
      input,
      stage: "session_identity",
      errorCode: "HARNESS_SESSION_ID_MISSING",
      prefix: "Harness requires an opaque session id"
    });
  }
  let stage = "session_start";
  try {
    const taskId = taskIdFor(host, sessionId);
    const session = startHarnessSession({
      projectRoot: root,
      host,
      sessionId,
      task: {
        id: taskId,
        goal: `${host === "claude" ? "Claude Code" : "Codex"} 受管项目任务`,
        acceptanceCriteria: ["Harness 记录完整且验证结果已写入"]
      }
    });
    stage = "event_append";
    appendHarnessEvent({
      projectRoot: root,
      taskId: session.taskId,
      event: phase === "pre"
        ? {event: "policy_decision", host, tool: toolCategory(input?.tool_name), decision: "allow"}
        : {event: "tool_completed", host, tool: toolCategory(input?.tool_name)}
    });
    return {decision: "allow", taskId: session.taskId};
  } catch (error) {
    return initializationFailure({phase, input, stage, errorCode: initializationErrorCode(error)});
  }
}

function logDiagnostics(result) {
  if (!result.diagnostics) return;
  process.stderr.write(`${JSON.stringify({
    component: "harness-hook",
    event: "initialization_failed",
    operationClass: result.operationClass,
    decision: result.decision,
    ...result.diagnostics
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
    input = {};
  }
  const result = handleHarnessHook({phase, input, host});
  logDiagnostics(result);
  if (phase === "pre") {
    writePreHookDecision(result);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const details = diagnostics("hook_protocol", initializationErrorCode(error));
    const result = {
      decision: "deny",
      degraded: true,
      operationClass: "unknown",
      diagnostics: details,
      reason: formattedReason(details, "unknown", "Harness hook failed")
    };
    logDiagnostics(result);
    writePreHookDecision(result);
  });
}
