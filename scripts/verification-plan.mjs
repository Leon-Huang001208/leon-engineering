#!/usr/bin/env node

import path from "node:path";
import {fileURLToPath} from "node:url";

import {buildLegacyVerificationPlan} from "../lib/verification/index.mjs";

export function buildVerificationPlan(options) {
  return buildLegacyVerificationPlan(options);
}

function parseArgs(args) {
  const options = {changedFiles: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--risk-tier", "--change-kind", "--changed-file"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--changed-file") options.changedFiles.push(value);
      else options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (["--help", "-h"].includes(argument)) options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function usage() {
  return "用法：verification-plan.mjs --project <项目目录> --risk-tier read-only|local-only|isolated|full-delivery --change-kind <类型> --changed-file <相对路径> [--changed-file ...]";
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.project) throw new Error("--project requires a value");
  process.stdout.write(`${JSON.stringify(buildVerificationPlan({
    projectRoot: options.project,
    riskTier: options.risk_tier,
    changeKind: options.change_kind,
    changedFiles: options.changedFiles,
  }), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`verification planning failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
