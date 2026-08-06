import crypto from "node:crypto";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {appendHarnessEvent, startHarnessSession} from "./harness-project.mjs";

function projectRoot(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  try {
    const root = fs.realpathSync(cwd);
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function opaqueSessionId(input) {
  const sessionId = input.session_id ?? process.env.CLAUDE_SESSION_ID;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(sessionId)) return null;
  return sessionId;
}

function toolCategory(name) {
  if (name === "Bash") return "shell";
  if (["Edit", "Write", "MultiEdit"].includes(name)) return "write";
  if (name === "Read") return "read";
  return "other";
}

function taskIdFor(sessionId) {
  return `task-${crypto.createHash("sha256").update(`claude:${sessionId}`).digest("hex").slice(0, 20)}`;
}

export function handleHarnessHook({phase, input}) {
  if (!new Set(["pre", "post"]).has(phase)) throw new Error("invalid harness hook phase");
  const root = projectRoot(input?.cwd);
  if (!root) return {decision: "allow", skipped: true};
  const sessionId = opaqueSessionId(input ?? {});
  if (!sessionId) {
    return phase === "pre"
      ? {decision: "deny", reason: "Harness requires an opaque Claude session id."}
      : {decision: "allow", skipped: true};
  }
  try {
    const taskId = taskIdFor(sessionId);
    const session = startHarnessSession({
      projectRoot: root,
      host: "claude",
      sessionId,
      task: {
        id: taskId,
        goal: "Claude Code 受管项目任务",
        acceptanceCriteria: ["Harness 记录完整且验证结果已写入"]
      }
    });
    appendHarnessEvent({
      projectRoot: root,
      taskId: session.taskId,
      event: phase === "pre"
        ? {event: "policy_decision", host: "claude", tool: toolCategory(input?.tool_name), decision: "allow"}
        : {event: "tool_completed", host: "claude", tool: toolCategory(input?.tool_name)}
    });
    return {decision: "allow", taskId: session.taskId};
  } catch {
    return phase === "pre"
      ? {decision: "deny", reason: "Harness initialization failed; project mutation is blocked."}
      : {decision: "allow", skipped: true};
  }
}

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== "--phase" || !["pre", "post"].includes(args[1])) {
    throw new Error("use --phase pre|post");
  }
  return {phase: args[1]};
}

async function main(args) {
  const {phase} = parseArgs(args);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    input = {};
  }
  const result = handleHarnessHook({phase, input});
  if (phase === "pre" && result.decision === "deny") {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
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
