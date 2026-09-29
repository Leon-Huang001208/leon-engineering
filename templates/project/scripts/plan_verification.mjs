#!/usr/bin/env node

import path from "node:path";
import {fileURLToPath} from "node:url";

import {planVerification} from "../../.agents/runtime/leon-engineering/lib/verification/index.mjs";

export {planVerification};

function parseArgs(args) {
  const options = {changedFiles: [], signals: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!["--project", "--changed-file", "--signal"].includes(argument)) throw new Error("unknown option");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    if (argument === "--project") options.projectRoot = value;
    else if (argument === "--changed-file") options.changedFiles.push(value);
    else options.signals.push(value);
    index += 1;
  }
  if (!options.projectRoot || options.changedFiles.length === 0) throw new Error("project and changed files are required");
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(planVerification(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({schemaVersion: 3, error: {code: error.code ?? "INTERNAL_ERROR", message: error.message}})}\n`);
    process.exitCode = 1;
  }
}
