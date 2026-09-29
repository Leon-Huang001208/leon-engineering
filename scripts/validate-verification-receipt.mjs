#!/usr/bin/env node

import path from "node:path";
import {fileURLToPath} from "node:url";

import {VerificationError} from "../lib/verification/errors.mjs";
import {validateVerificationReceipt} from "../lib/verification/receipt.mjs";

function parseArgs(args) {
  const options = {};
  const names = new Map([["--project", "projectRoot"], ["--plan", "planPath"], ["--receipt", "receiptPath"]]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return {help: true};
    const name = names.get(argument);
    if (!name) throw new VerificationError("ARGUMENT_ERROR", "unknown option");
    const value = args[index + 1];
    if (!value || value.startsWith("--") || options[name] !== undefined) {
      throw new VerificationError("ARGUMENT_ERROR", `${argument} requires one value`);
    }
    options[name] = value;
    index += 1;
  }
  for (const [option, name] of names) {
    if (!options[name]) throw new VerificationError("ARGUMENT_ERROR", `${option} is required`);
  }
  return options;
}

function usage() {
  return "用法：validate-verification-receipt.mjs --project <项目目录> --plan <plan.json> --receipt <receipt.json>";
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(validateVerificationReceipt(options), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof VerificationError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof VerificationError ? error.message : "unexpected receipt validation failure";
    process.stderr.write(`${JSON.stringify({schemaVersion: 2, error: {code, message}})}\n`);
    process.exitCode = 1;
  }
}
