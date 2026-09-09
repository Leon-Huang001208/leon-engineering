import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {appendHarnessEvent, startHarnessSession} from "./harness-project.mjs";
import {defaultHarnessRuntimeRoot} from "./harness-runtime.mjs";

const RUNTIME_PATH = path.join(defaultHarnessRuntimeRoot(), "harness-runtime.mjs");
const MANIFEST_PATH = path.join(defaultHarnessRuntimeRoot(), ".leon-engineering-harness-runtime.json");

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
  if (name === "Bash") return "shell";
  if (["apply_patch", "Edit", "Write", "MultiEdit"].includes(name)) return "write";
  if (name === "Read") return "read";
  return "other";
}

function diagnosticShellCommand(input) {
  const data = input?.tool_input;
  const command = typeof data?.command === "string"
    ? data.command.trim()
    : typeof data?.cmd === "string" ? data.cmd.trim() : "";
  if (new Set(["pwd", "/bin/pwd"]).has(command)) return true;
  return new Set([
    `node ${RUNTIME_PATH} --verify`,
    `node "${RUNTIME_PATH}" --verify`,
    `node '${RUNTIME_PATH}' --verify`,
    `${process.execPath} ${RUNTIME_PATH} --verify`,
    `${process.execPath} "${RUNTIME_PATH}" --verify`,
    `${process.execPath} '${RUNTIME_PATH}' --verify`
  ]).has(command);
}

function operationCategory(input) {
  const name = input?.tool_name;
  if (name === "Read") return "diagnostic_read";
  if (name === "Bash") return diagnosticShellCommand(input) ? "diagnostic_read" : "mutation";
  if (["apply_patch", "Edit", "Write", "MultiEdit"].includes(name)) return "mutation";
  return "unknown";
}

function failureCode(error) {
  if (!error) return "missing_session_id";
  if (error.message === "invalid harness session") return "invalid_harness_session";
  return "harness_initialization_failed";
}

function failureDiagnostic(phase, error) {
  return {
    phase,
    code: failureCode(error),
    runtimePath: RUNTIME_PATH,
    manifestPath: MANIFEST_PATH,
    recovery: "Run the managed runtime with --verify; if verification fails, reinstall from the canonical leon-engineering source."
  };
}

function initializationFailure({phase, input, error}) {
  const operation = operationCategory(input);
  const diagnostic = failureDiagnostic(phase, error);
  if (phase === "post") return {decision: "allow", skipped: true, operation, diagnostic};
  if (operation === "diagnostic_read") return {decision: "allow", degraded: true, operation, diagnostic};
  return {
    decision: "deny",
    reason: diagnostic.code === "missing_session_id"
      ? "Harness requires an opaque session id; only diagnostic reads are allowed."
      : "Harness initialization failed; only diagnostic reads are allowed.",
    operation,
    diagnostic
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
    return initializationFailure({phase, input});
  }
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
    appendHarnessEvent({
      projectRoot: root,
      taskId: session.taskId,
      event: phase === "pre"
        ? {event: "policy_decision", host, tool: toolCategory(input?.tool_name), decision: "allow"}
        : {event: "tool_completed", host, tool: toolCategory(input?.tool_name)}
    });
    return {decision: "allow", taskId: session.taskId};
  } catch (error) {
    return initializationFailure({phase, input, error});
  }
}

function logDiagnostic(diagnostic) {
  process.stderr.write(`${JSON.stringify({component: "harness-hook", ...diagnostic})}\n`);
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
  if (result.diagnostic) logDiagnostic(result.diagnostic);
  if (phase === "pre" && result.decision === "deny") {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: result.reason
    }}));
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(() => {
    logDiagnostic({...failureDiagnostic("unknown", new Error("hook execution failed")), code: "hook_execution_failed"});
    process.stdout.write(JSON.stringify({hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Harness hook failed; only diagnostic reads are allowed."
    }}));
  });
}
