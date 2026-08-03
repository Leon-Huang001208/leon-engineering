import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- leon-engineering:claude-policy:start -->";
const END = "<!-- leon-engineering:claude-policy:end -->";
const MANIFEST = ".leon-engineering-claude-policy.json";

function log(event, details = {}) {
  console.error(JSON.stringify({component: "claude-adapter", event, ...details}));
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function claudeFile(claudeHome) {
  return path.join(claudeHome, "CLAUDE.md");
}

function manifestFile(claudeHome) {
  return path.join(claudeHome, MANIFEST);
}

function writeAtomically(destination, content) {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`
  );
  fs.writeFileSync(temporary, content, {mode: 0o600});
  fs.renameSync(temporary, destination);
}

function markerRange(content) {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error("invalid Claude policy markers");
  }
  if (start === -1) return null;
  if (
    content.indexOf(START, start + START.length) !== -1
    || content.indexOf(END, end + END.length) !== -1
  ) {
    throw new Error("invalid Claude policy markers");
  }
  return {start, end: end + END.length};
}

function readClaudeFile(claudeHome) {
  const file = claudeFile(claudeHome);
  if (!fs.existsSync(file)) return {content: "", hadClaudeFile: false};
  if (!fs.statSync(file).isFile()) throw new Error("CLAUDE.md is not a file");
  return {content: fs.readFileSync(file, "utf8"), hadClaudeFile: true};
}

function policySource(sourceRoot) {
  const file = path.join(sourceRoot, "adapters", "claude", "global-policy.md");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error("missing canonical Claude policy");
  }
  const policy = fs.readFileSync(file, "utf8").trim();
  if (!policy || policy.includes(START) || policy.includes(END)) {
    throw new Error("invalid canonical Claude policy");
  }
  return policy;
}

function renderPolicyBlock(policy) {
  return `${START}\n${policy}\n${END}`;
}

function frameworkVersion(sourceRoot) {
  try {
    const plugin = JSON.parse(
      fs.readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"), "utf8")
    );
    if (typeof plugin.version !== "string" || plugin.version.length === 0) {
      throw new Error("missing version");
    }
    return plugin.version;
  } catch {
    throw new Error("cannot read framework version");
  }
}

function sourceCommit(sourceRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    throw new Error("cannot read source commit");
  }
}

function assertPolicyManifest(policy) {
  if (
    !policy
    || typeof policy !== "object"
    || Array.isArray(policy)
    || !/^[0-9a-f]{64}$/.test(policy.checksum)
    || typeof policy.prefix !== "string"
    || typeof policy.suffix !== "string"
    || typeof policy.hadClaudeFile !== "boolean"
  ) {
    throw new Error("invalid Claude policy manifest");
  }
}

function readManifest(claudeHome) {
  const file = manifestFile(claudeHome);
  if (!fs.existsSync(file)) return null;
  if (!fs.statSync(file).isFile()) throw new Error("invalid Claude policy manifest");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("invalid Claude policy manifest");
  }
  if (
    !manifest
    || typeof manifest !== "object"
    || manifest.schemaVersion !== 1
    || manifest.adapter !== "leon-engineering"
  ) {
    throw new Error("invalid Claude policy manifest");
  }
  assertPolicyManifest(manifest.policy);
  return manifest;
}

function insertion({claude, range, block, manifest}) {
  if (range) {
    return {
      content: `${claude.content.slice(0, range.start)}${block}${claude.content.slice(range.end)}`,
      prefix: manifest.policy.prefix,
      suffix: manifest.policy.suffix,
      hadClaudeFile: manifest.policy.hadClaudeFile
    };
  }
  const prefix = claude.content.length === 0
    ? ""
    : claude.content.endsWith("\n") ? "\n" : "\n\n";
  const suffix = "\n";
  return {
    content: `${claude.content}${prefix}${block}${suffix}`,
    prefix,
    suffix,
    hadClaudeFile: claude.hadClaudeFile
  };
}

function assertInstallPreflight({claude, range, manifest}) {
  if (range && !manifest) throw new Error("foreign Claude policy block");
  if (manifest && !range) throw new Error("missing managed Claude policy block");
  if (manifest && range) {
    const installed = claude.content.slice(range.start, range.end);
    if (checksum(installed) !== manifest.policy.checksum) {
      throw new Error("drifted Claude policy block");
    }
  }
}

export function installClaudePolicy({sourceRoot = SOURCE_ROOT, claudeHome}) {
  if (!claudeHome) throw new Error("claudeHome is required");
  fs.mkdirSync(claudeHome, {recursive: true});

  try {
    const policy = policySource(sourceRoot);
    const claude = readClaudeFile(claudeHome);
    const range = markerRange(claude.content);
    const existingManifest = readManifest(claudeHome);
    assertInstallPreflight({claude, range, manifest: existingManifest});

    const installed = insertion({
      claude,
      range,
      block: renderPolicyBlock(policy),
      manifest: existingManifest
    });
    const manifest = {
      schemaVersion: 1,
      adapter: "leon-engineering",
      frameworkVersion: frameworkVersion(sourceRoot),
      sourceCommit: sourceCommit(sourceRoot),
      policy: {
        checksum: checksum(renderPolicyBlock(policy)),
        prefix: installed.prefix,
        suffix: installed.suffix,
        hadClaudeFile: installed.hadClaudeFile
      }
    };
    writeAtomically(claudeFile(claudeHome), installed.content);
    writeAtomically(manifestFile(claudeHome), `${JSON.stringify(manifest, null, 2)}\n`);
    log("installed");
    return {manifest};
  } catch (error) {
    log("install_failed");
    throw error;
  }
}

export function verifyClaudePolicy({sourceRoot = SOURCE_ROOT, claudeHome}) {
  if (!claudeHome) throw new Error("claudeHome is required");
  const manifest = readManifest(claudeHome);
  if (!manifest) throw new Error("Claude policy manifest not found");

  const drift = [];
  try {
    const expected = renderPolicyBlock(policySource(sourceRoot));
    const claude = readClaudeFile(claudeHome);
    const range = markerRange(claude.content);
    const installed = range ? claude.content.slice(range.start, range.end) : "";
    if (
      !range
      || checksum(installed) !== manifest.policy.checksum
      || installed !== expected
    ) {
      drift.push("policy");
    }
  } catch {
    drift.push("policy");
  }
  const result = {valid: drift.length === 0, drift};
  log("verified", {valid: result.valid, driftCount: drift.length});
  return result;
}

export function rollbackClaudePolicy({sourceRoot = SOURCE_ROOT, claudeHome}) {
  if (!claudeHome) throw new Error("claudeHome is required");
  const manifest = readManifest(claudeHome);
  if (!manifest) throw new Error("Claude policy manifest not found");
  const verification = verifyClaudePolicy({sourceRoot, claudeHome});
  if (!verification.valid) throw new Error("refusing to rollback drifted Claude policy");

  try {
    const claude = readClaudeFile(claudeHome);
    const range = markerRange(claude.content);
    const before = claude.content.slice(0, range.start);
    const after = claude.content.slice(range.end);
    if (
      !before.endsWith(manifest.policy.prefix)
      || !after.startsWith(manifest.policy.suffix)
    ) {
      throw new Error("invalid managed Claude policy placement");
    }
    const restored = `${before.slice(0, before.length - manifest.policy.prefix.length)}${after.slice(manifest.policy.suffix.length)}`;
    if (!manifest.policy.hadClaudeFile && restored.length === 0) {
      fs.rmSync(claudeFile(claudeHome));
    } else {
      writeAtomically(claudeFile(claudeHome), restored);
    }
    fs.rmSync(manifestFile(claudeHome));
    log("rolled_back");
  } catch (error) {
    log("rollback_failed");
    throw error;
  }
}

function parseCli(args) {
  const actionFlags = new Set(["--install", "--verify", "--rollback"]);
  const actions = args.filter(argument => actionFlags.has(argument));
  if (actions.length !== 1) throw new Error("use exactly one action");

  const homeIndexes = args.reduce(
    (indexes, value, index) => value === "--claude-home" ? [...indexes, index] : indexes,
    []
  );
  if (homeIndexes.length > 1) throw new Error("--claude-home may be supplied once");
  const homeIndex = homeIndexes[0];
  if (
    homeIndex !== undefined
    && (!args[homeIndex + 1] || args[homeIndex + 1].startsWith("--"))
  ) {
    throw new Error("--claude-home requires a directory");
  }

  const accepted = new Set(actions);
  if (homeIndex !== undefined) {
    accepted.add("--claude-home");
    accepted.add(args[homeIndex + 1]);
  }
  if (args.some(argument => !accepted.has(argument))) throw new Error("unsupported argument");

  return {
    action: actions[0],
    claudeHome: homeIndex === undefined ? path.join(os.homedir(), ".claude") : args[homeIndex + 1]
  };
}

function main(args) {
  const {action, claudeHome} = parseCli(args);
  if (action === "--install") {
    console.log(JSON.stringify(installClaudePolicy({claudeHome}), null, 2));
  } else if (action === "--verify") {
    console.log(JSON.stringify(verifyClaudePolicy({claudeHome}), null, 2));
  } else {
    rollbackClaudePolicy({claudeHome});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch {
    log("command_failed");
    process.exitCode = 1;
  }
}
