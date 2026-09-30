import { fileURLToPath } from "node:url";

const denyCommand = [
  /\brm\s+-[^\n]*r[^\n]*f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f\b/i,
  /\bgit\s+push\b[^\n]*--force/i,
  /\bsudo\b/i,
  /\bcurl\b[^\n]*\|\s*(?:ba)?sh\b/i,
  /\bnpm\s+install\s+-g\b/i
];

const askCommand = [
  /\bgit\s+(?:push|rebase)\b/i,
  /\b(?:pip|pip3)\s+install\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|remove|update)\b/i,
  /\b(?:alembic|prisma|typeorm)\b[^\n]*(?:migrate|migration)/i,
  /\b(?:deploy|release|publish)\b/i
];

const denyPath = /(?:^|\/)\.env(?:\.[^/]+)?$|(?:^|\/)\.(?:npmrc|pypirc)$|(?:^|\/)(?:credentials|secrets?)(?:\.|\/|$)/i;
const askPath = /(?:^|\/)(?:\.github\/workflows|\.gitlab-ci|Jenkinsfile|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements(?:[-\w]*)?\.txt)(?:$|\/)/i;
const guardedTools = new Set(["Bash", "Edit", "Write", "MultiEdit", "apply_patch"]);

function affectedPaths(tool, data) {
  const paths = [data.file_path ?? data.path].filter(value => typeof value === "string");
  if (tool !== "apply_patch") return paths;
  if (typeof data.command !== "string") return null;
  for (const match of data.command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) {
    paths.push((match[1] ?? match[2]).trim());
  }
  return paths.length > 0 ? paths : null;
}

export function decide(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.tool_name !== "string" || input.tool_name.length === 0
    || !input.tool_input || typeof input.tool_input !== "object" || Array.isArray(input.tool_input)) {
    return {decision: "deny", reason: "Invalid hook input."};
  }
  const tool = input.tool_name ?? "";
  const data = input.tool_input ?? {};
  if (!guardedTools.has(tool)) return {decision: "deny", reason: "Unsupported hook tool."};
  if (tool === "Bash" && (typeof data.command !== "string" || data.command.length === 0)) {
    return {decision: "deny", reason: "Invalid hook input."};
  }
  const command = String(data.command ?? "");
  const paths = affectedPaths(tool, data);
  if (paths === null || (["Edit", "Write", "MultiEdit"].includes(tool) && paths.length === 0)) {
    return {decision: "deny", reason: "Invalid file input."};
  }

  if ((tool === "Bash" && denyCommand.some((pattern) => pattern.test(command))) || paths.some(path => denyPath.test(path))) {
    return {decision: "deny", reason: "Potentially destructive, secret-bearing, or system-wide action."};
  }
  if ((tool === "Bash" && askCommand.some((pattern) => pattern.test(command))) || paths.some(path => askPath.test(path))) {
    return {decision: "ask", reason: "Remote, dependency, or infrastructure mutation requires confirmation."};
  }
  return {decision: "allow", reason: "Routine local engineering action."};
}

function encodeDecision(result, codexPlugin) {
  if (codexPlugin && result.decision === "allow") return "";
  const decision = codexPlugin && result.decision === "ask" ? "deny" : result.decision;
  const reason = codexPlugin && result.decision === "ask"
    ? "Manual confirmation required; this Codex PreToolUse hook cannot request approval. Ask the user to perform the action after review."
    : result.reason;
  return JSON.stringify({hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: decision,
    permissionDecisionReason: reason
  }});
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let result;
  try {
    result = decide(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
  } catch {
    result = {decision: "deny", reason: "Invalid hook input."};
    process.stderr.write(`${JSON.stringify({component: "guard", event: "input_rejected", code: "INVALID_JSON"})}\n`);
  }
  process.stdout.write(encodeDecision(result, Boolean(process.env.PLUGIN_ROOT)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify({component: "guard", event: "execution_failed", code: "GUARD_ERROR"})}\n`);
    process.stdout.write(encodeDecision({decision: "deny", reason: "Guard execution failed."}, Boolean(process.env.PLUGIN_ROOT)));
  });
}
