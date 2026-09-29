#!/usr/bin/env node

import {fileURLToPath} from "node:url";
import {ArchitectureMapError, validateArchitectureMap} from "../lib/governance/architecture-map.mjs";

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return {help: true};
    if (argument !== "--project") throw new ArchitectureMapError("ARGUMENT_ERROR", "unknown option");
    const value = args[index + 1];
    if (!value || value.startsWith("--") || options.project) {
      throw new ArchitectureMapError("ARGUMENT_ERROR", "--project requires one value");
    }
    options.project = value;
    index += 1;
  }
  if (!options.project) throw new ArchitectureMapError("ARGUMENT_ERROR", "--project is required");
  return options;
}

function usage() {
  return "用法：check-architecture-map.mjs --project <项目目录>";
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(validateArchitectureMap({projectRoot: options.project}), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof ArchitectureMapError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof ArchitectureMapError ? error.message : "unexpected architecture map failure";
    process.stderr.write(`${JSON.stringify({component: "architecture-map", event: "validation_failed", code, message})}\n`);
    process.exitCode = 1;
  }
}
