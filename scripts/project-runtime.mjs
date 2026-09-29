#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

async function loadManagedRuntime() {
  const candidates = ["../lib/project/managed-runtime.mjs", "./lib/project/managed-runtime.mjs"];
  for (const candidate of candidates) {
    try {
      return await import(new URL(candidate, import.meta.url));
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("project runtime manager is unavailable");
}

const {
  applyProjectRuntime,
  previewProjectRuntime,
  rollbackProjectRuntime,
  verifyProjectRuntime,
} = await loadManagedRuntime();
const DEFAULT_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(args) {
  const options = {action: "preview"};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return {help: true};
    if (["--apply", "--verify", "--rollback"].includes(argument)) {
      if (options.action !== "preview") throw new Error("choose exactly one project runtime action");
      options.action = argument.slice(2);
      continue;
    }
    if (!["--project", "--source", "--receipt"].includes(argument)) throw new Error("unknown option");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.project) throw new Error("--project is required");
  if (options.action === "rollback") {
    if (!options.receipt || options.source) throw new Error("rollback requires --receipt and no --source");
  } else {
    if (options.receipt) throw new Error("--receipt is only valid with --rollback");
    options.source ??= DEFAULT_SOURCE;
    if (!fs.existsSync(path.join(options.source, ".claude-plugin", "plugin.json"))) {
      throw new Error("--source must identify a canonical leon-engineering checkout");
    }
  }
  return options;
}

function usage() {
  return [
    "用法：project-runtime.mjs --project <项目目录> [--source <leon源码>]",
    "      project-runtime.mjs --apply --project <项目目录> [--source <leon源码>]",
    "      project-runtime.mjs --verify --project <项目目录> [--source <leon源码>]",
    "      project-runtime.mjs --rollback --project <项目目录> --receipt <私有回执>",
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const common = {projectRoot: options.project, sourceRoot: options.source};
  const result = options.action === "apply" ? applyProjectRuntime(common)
    : options.action === "verify" ? verifyProjectRuntime(common)
      : options.action === "rollback" ? rollbackProjectRuntime({projectRoot: options.project, receiptPath: options.receipt})
        : previewProjectRuntime(common);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (options.action === "verify" && !result.valid) process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({component: "project-runtime", event: "operation_failed", message: error.message})}\n`);
    process.exitCode = 1;
  }
}
