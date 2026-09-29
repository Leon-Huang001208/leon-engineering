#!/usr/bin/env node

import path from "node:path";
import {fileURLToPath} from "node:url";

import {validateVerificationReceipt} from "../../.agents/runtime/leon-engineering/lib/verification/index.mjs";

export {validateVerificationReceipt};

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!["--project", "--plan", "--receipt"].includes(argument)) throw new Error("unknown option");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.project || !options.plan || !options.receipt) throw new Error("project, plan and receipt are required");
  return {projectRoot: options.project, planPath: options.plan, receiptPath: options.receipt};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(validateVerificationReceipt(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({schemaVersion: 2, error: {code: error.code ?? "INTERNAL_ERROR", message: error.message}})}\n`);
    process.exitCode = 1;
  }
}
