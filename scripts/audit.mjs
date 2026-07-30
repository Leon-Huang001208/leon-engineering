import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function toAuditEvent(input) {
  return {
    timestamp: new Date().toISOString(),
    event: String(input.hook_event_name ?? "unknown"),
    tool: String(input.tool_name ?? "unknown")
  };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const event = toAuditEvent(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
  const directory = path.join(os.homedir(), ".claude", "audit");
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  fs.appendFileSync(path.join(directory, "events.jsonl"), `${JSON.stringify(event)}\n`, {mode: 0o600});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`audit failure: ${error.message}\n`);
    process.exit(0);
  });
}
