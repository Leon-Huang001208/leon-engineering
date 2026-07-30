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

export function decide(input) {
  const tool = input.tool_name ?? "";
  const data = input.tool_input ?? {};
  const command = String(data.command ?? "");
  const path = String(data.file_path ?? data.path ?? "");

  if ((tool === "Bash" && denyCommand.some((pattern) => pattern.test(command))) || denyPath.test(path)) {
    return {decision: "deny", reason: "Potentially destructive, secret-bearing, or system-wide action."};
  }
  if ((tool === "Bash" && askCommand.some((pattern) => pattern.test(command))) || askPath.test(path)) {
    return {decision: "ask", reason: "Remote, dependency, or infrastructure mutation requires confirmation."};
  }
  return {decision: "allow", reason: "Routine local engineering action."};
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = decide(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
  process.stdout.write(JSON.stringify({hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: result.decision,
    permissionDecisionReason: result.reason
  }}));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`guard failure: ${error.message}\n`);
    process.exit(1);
  });
}
