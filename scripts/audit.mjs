import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {handleHarnessHook} from "./harness-hook.mjs";

export function toAuditEvent(input) {
  return {
    timestamp: new Date().toISOString(),
    event: String(input.hook_event_name ?? "unknown"),
    tool: String(input.tool_name ?? "unknown")
  };
}

export function forwardAuditToHarness(input) {
  return handleHarnessHook({phase: "post", input});
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  forwardAuditToHarness(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`audit failure: ${error.message}\n`);
    process.exit(0);
  });
}
