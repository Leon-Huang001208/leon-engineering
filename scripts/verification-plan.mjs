#!/usr/bin/env node

import path from "node:path";
import {fileURLToPath} from "node:url";

import {buildLegacyVerificationPlan, planGitVerification} from "../lib/verification/index.mjs";

export function buildVerificationPlan(options) {
  return buildLegacyVerificationPlan(options);
}

function parseArgs(args) {
  const options = {changedFiles: [], signals: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--risk-tier", "--change-kind", "--changed-file", "--base", "--signal"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--changed-file") options.changedFiles.push(value);
      else if (argument === "--signal") options.signals.push(value);
      else options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (["--help", "-h"].includes(argument)) options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    "用法：verification-plan.mjs --project <项目目录> --risk-tier read-only|local-only|isolated|full-delivery --change-kind <类型> --changed-file <相对路径> [--changed-file ...]",
    "      verification-plan.mjs --project <项目目录> --base <Git基线> [--changed-file <完整路径集> ...] [--signal validation_failure|unexpected_behavior]",
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.project) throw new Error("--project requires a value");
  const plan = options.base ? planGitVerification({
    projectRoot: options.project,
    base: options.base,
    changedFiles: options.changedFiles.length > 0 ? options.changedFiles : undefined,
    signals: options.signals,
  }) : buildVerificationPlan({
      projectRoot: options.project,
      riskTier: options.risk_tier,
      changeKind: options.change_kind,
      changedFiles: options.changedFiles,
    });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`verification planning failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
