import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {installHarnessRuntime, verifyHarnessRuntime} from "./harness-runtime.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- leon-engineering:claude-policy:start -->";
const END = "<!-- leon-engineering:claude-policy:end -->";
const MANIFEST = ".leon-engineering-claude-policy.json";
const STATES = new Set(["installing", "active", "rolling_back"]);

class AdapterError extends Error {
  constructor(message, code = "operation_failed") {
    super(message);
    this.code = code;
  }
}

function fail(message, code) {
  return new AdapterError(message, code);
}

function log(event, details = {}) {
  console.error(JSON.stringify({component: "claude-adapter", event, ...details}));
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function placementChecksum({prefix, suffix, hadClaudeFile}) {
  return checksum(JSON.stringify({prefix, suffix, hadClaudeFile}));
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
  try {
    fs.writeFileSync(temporary, content, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    try {
      fs.rmSync(temporary, {force: true});
    } catch {
      // A failed cleanup must not obscure the original write or rename error.
    }
  }
}

function markerRange(content) {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw fail("invalid Claude policy markers", "drifted_policy");
  }
  if (start === -1) return null;
  if (
    content.indexOf(START, start + START.length) !== -1
    || content.indexOf(END, end + END.length) !== -1
  ) {
    throw fail("invalid Claude policy markers", "drifted_policy");
  }
  return {start, end: end + END.length};
}

function readClaudeFile(claudeHome) {
  const file = claudeFile(claudeHome);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return {content: "", hadClaudeFile: false};
    throw fail("cannot inspect CLAUDE.md target", "invalid_target");
  }
  if (stat.isSymbolicLink()) throw fail("CLAUDE.md cannot be a symbolic link", "invalid_target");
  if (!stat.isFile()) throw fail("CLAUDE.md is not a file", "invalid_target");
  return {content: fs.readFileSync(file, "utf8"), hadClaudeFile: true};
}

function policySource(sourceRoot) {
  const file = path.join(sourceRoot, "adapters", "claude", "global-policy.md");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw fail("missing canonical Claude policy");
  }
  const policy = fs.readFileSync(file, "utf8").trim();
  if (!policy || policy.includes(START) || policy.includes(END)) {
    throw fail("invalid canonical Claude policy");
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
    throw fail("cannot read framework version");
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
    throw fail("cannot read source commit");
  }
}

function assertPolicyManifest(policy) {
  if (
    !policy
    || typeof policy !== "object"
    || Array.isArray(policy)
    || !/^[0-9a-f]{64}$/.test(policy.checksum)
    || !/^[0-9a-f]{64}$/.test(policy.placementChecksum)
    || typeof policy.prefix !== "string"
    || typeof policy.suffix !== "string"
    || typeof policy.hadClaudeFile !== "boolean"
  ) {
    throw fail("invalid Claude policy manifest", "invalid_manifest");
  }
}

function assertManifest(manifest) {
  if (
    !manifest
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || manifest.schemaVersion !== 1
    || manifest.adapter !== "leon-engineering"
    || typeof manifest.frameworkVersion !== "string"
    || typeof manifest.sourceCommit !== "string"
    || !STATES.has(manifest.state)
  ) {
    throw fail("invalid Claude policy manifest", "invalid_manifest");
  }
  assertPolicyManifest(manifest.policy);
  if (manifest.transition !== undefined) {
    if (
      !manifest.transition
      || typeof manifest.transition !== "object"
      || Array.isArray(manifest.transition)
      || !Object.hasOwn(manifest.transition, "previousPolicyChecksum")
      || (
        manifest.transition.previousPolicyChecksum !== null
        && !/^[0-9a-f]{64}$/.test(manifest.transition.previousPolicyChecksum)
      )
    ) {
      throw fail("invalid Claude policy manifest", "invalid_manifest");
    }
  }
}

function previousPolicyChecksum(manifest) {
  return manifest.transition?.previousPolicyChecksum ?? null;
}

function readManifestRecord(claudeHome) {
  const file = manifestFile(claudeHome);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw fail("cannot inspect Claude policy manifest target", "invalid_target");
  }
  if (stat.isSymbolicLink()) {
    throw fail("Claude policy manifest cannot be a symbolic link", "invalid_target");
  }
  if (!stat.isFile()) {
    throw fail("invalid Claude policy manifest", "invalid_manifest");
  }
  const raw = fs.readFileSync(file, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw fail("invalid Claude policy manifest", "invalid_manifest");
  }
  assertManifest(manifest);
  return {manifest, raw};
}

function removeManifest(claudeHome) {
  fs.rmSync(manifestFile(claudeHome), {force: true});
}

function managedBlockIsIntact({claude, range, manifest, checksumToMatch = manifest.policy.checksum}) {
  if (!range) return false;
  const installed = claude.content.slice(range.start, range.end);
  const before = claude.content.slice(0, range.start);
  const after = claude.content.slice(range.end);
  return (
    checksum(installed) === checksumToMatch
    && manifest.policy.placementChecksum === placementChecksum(manifest.policy)
    && before.endsWith(manifest.policy.prefix)
    && after.startsWith(manifest.policy.suffix)
  );
}

function activeManifest(manifest) {
  const next = {...manifest, state: "active"};
  delete next.transition;
  return next;
}

function rollingBackManifest(manifest) {
  const next = {...manifest, state: "rolling_back"};
  delete next.transition;
  return next;
}

function buildInstallingManifest({sourceRoot, block, placement, previousPolicyChecksum}) {
  return {
    schemaVersion: 1,
    adapter: "leon-engineering",
    frameworkVersion: frameworkVersion(sourceRoot),
    sourceCommit: sourceCommit(sourceRoot),
    state: "installing",
    policy: {
      checksum: checksum(block),
      prefix: placement.prefix,
      suffix: placement.suffix,
      hadClaudeFile: placement.hadClaudeFile,
      placementChecksum: placementChecksum(placement)
    },
    transition: {previousPolicyChecksum}
  };
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

function recoverPendingForInstall({claudeHome, manifest, claude, range}) {
  if (manifest.state === "active") return manifest;

  if (manifest.state === "installing") {
    if (!range) {
      if (previousPolicyChecksum(manifest) !== null) {
        throw fail("drifted Claude policy block", "drifted_policy");
      }
      removeManifest(claudeHome);
      return null;
    }
    if (managedBlockIsIntact({claude, range, manifest})) {
      const active = activeManifest(manifest);
      writeAtomically(manifestFile(claudeHome), `${JSON.stringify(active, null, 2)}\n`);
      return active;
    }
    if (
      previousPolicyChecksum(manifest) !== null
      && managedBlockIsIntact({
        claude,
        range,
        manifest,
        checksumToMatch: previousPolicyChecksum(manifest)
      })
    ) {
      return manifest;
    }
    throw fail("drifted Claude policy block", "drifted_policy");
  }

  if (!range) {
    removeManifest(claudeHome);
    return null;
  }
  if (!managedBlockIsIntact({claude, range, manifest})) {
    throw fail("drifted Claude policy block", "drifted_policy");
  }
  throw fail("Claude policy rollback is pending");
}

function recoverPendingForVerify({claudeHome, manifest, claude, range}) {
  if (manifest.state === "active") return manifest;
  if (manifest.state === "installing" && managedBlockIsIntact({claude, range, manifest})) {
    const active = activeManifest(manifest);
    writeAtomically(manifestFile(claudeHome), `${JSON.stringify(active, null, 2)}\n`);
    return active;
  }
  if (!range) {
    if (
      manifest.state === "rolling_back"
      || manifest.transition?.previousPolicyChecksum === null
    ) {
      removeManifest(claudeHome);
      return null;
    }
  }
  return manifest;
}

function restoreInstallSnapshot({claudeHome, claude, manifestRaw}) {
  let claudeRestored = false;
  try {
    if (!claude.hadClaudeFile && claude.content.length === 0) {
      fs.rmSync(claudeFile(claudeHome), {force: true});
    } else {
      writeAtomically(claudeFile(claudeHome), claude.content);
    }
    claudeRestored = true;
  } catch {
    // The pending state retains enough evidence for a later safe recovery.
  }
  if (!claudeRestored) return;
  try {
    if (manifestRaw === null) {
      removeManifest(claudeHome);
    } else {
      writeAtomically(manifestFile(claudeHome), manifestRaw);
    }
  } catch {
    // Preserve the original failure while leaving only a recoverable pending state.
  }
}

export function installClaudePolicy({sourceRoot = SOURCE_ROOT, claudeHome}) {
  if (!claudeHome) throw fail("claudeHome is required", "invalid_arguments");
  fs.mkdirSync(claudeHome, {recursive: true});

  try {
    const policy = policySource(sourceRoot);
    let record = readManifestRecord(claudeHome);
    let claude = readClaudeFile(claudeHome);
    let range = markerRange(claude.content);
    if (record) {
      recoverPendingForInstall({claudeHome, manifest: record.manifest, claude, range});
      record = readManifestRecord(claudeHome);
      claude = readClaudeFile(claudeHome);
      range = markerRange(claude.content);
    }

    if (range && !record) throw fail("foreign Claude policy block", "foreign_policy");
    if (record?.manifest.state === "active" && !managedBlockIsIntact({
      claude,
      range,
      manifest: record.manifest
    })) {
      throw fail("drifted Claude policy block", "drifted_policy");
    }
    if (record?.manifest.state === "installing" && !managedBlockIsIntact({
      claude,
      range,
      manifest: record.manifest,
      checksumToMatch: previousPolicyChecksum(record.manifest)
    })) {
      throw fail("drifted Claude policy block", "drifted_policy");
    }

    const block = renderPolicyBlock(policy);
    const placement = insertion({
      claude,
      range,
      block,
      manifest: record?.manifest
    });
    const currentBlockChecksum = range
      ? checksum(claude.content.slice(range.start, range.end))
      : null;
    const pending = buildInstallingManifest({
      sourceRoot,
      block,
      placement,
      previousPolicyChecksum: currentBlockChecksum
    });
    const originalManifestRaw = record?.raw ?? null;

    try {
      writeAtomically(manifestFile(claudeHome), `${JSON.stringify(pending, null, 2)}\n`);
      writeAtomically(claudeFile(claudeHome), placement.content);
      const active = activeManifest(pending);
      writeAtomically(manifestFile(claudeHome), `${JSON.stringify(active, null, 2)}\n`);
      log("installed");
      return {manifest: active};
    } catch (error) {
      restoreInstallSnapshot({claudeHome, claude, manifestRaw: originalManifestRaw});
      throw error;
    }
  } catch (error) {
    log("install_failed");
    throw error;
  }
}

export function verifyClaudePolicy({sourceRoot = SOURCE_ROOT, claudeHome, logResult = true}) {
  if (!claudeHome) throw fail("claudeHome is required", "invalid_arguments");
  let record = readManifestRecord(claudeHome);
  if (!record) throw fail("Claude policy manifest not found", "invalid_manifest");

  let claude = readClaudeFile(claudeHome);
  let range = markerRange(claude.content);
  const recovered = recoverPendingForVerify({
    claudeHome,
    manifest: record.manifest,
    claude,
    range
  });
  if (!recovered) throw fail("Claude policy manifest not found", "invalid_manifest");
  record = readManifestRecord(claudeHome);
  claude = readClaudeFile(claudeHome);
  range = markerRange(claude.content);

  const drift = [];
  try {
    const expected = renderPolicyBlock(policySource(sourceRoot));
    const installed = range ? claude.content.slice(range.start, range.end) : "";
    if (
      !managedBlockIsIntact({claude, range, manifest: record.manifest})
      || installed !== expected
    ) {
      drift.push("policy");
    }
  } catch {
    drift.push("policy");
  }
  const result = {valid: drift.length === 0, drift};
  if (logResult) log("verified", {valid: result.valid, driftCount: drift.length});
  return result;
}

export function rollbackClaudePolicy({sourceRoot = SOURCE_ROOT, claudeHome}) {
  if (!claudeHome) throw fail("claudeHome is required", "invalid_arguments");
  let record = readManifestRecord(claudeHome);
  if (!record) throw fail("Claude policy manifest not found", "invalid_manifest");
  let claude = readClaudeFile(claudeHome);
  let range = markerRange(claude.content);

  if (record.manifest.state === "rolling_back" && !range) {
    removeManifest(claudeHome);
    log("rolled_back");
    return;
  }
  if (record.manifest.state === "installing") {
    recoverPendingForInstall({claudeHome, manifest: record.manifest, claude, range});
    record = readManifestRecord(claudeHome);
    if (!record) {
      log("rolled_back");
      return;
    }
  }

  const verification = verifyClaudePolicy({sourceRoot, claudeHome});
  if (!verification.valid) {
    throw fail("refusing to rollback drifted Claude policy", "drifted_policy");
  }
  record = readManifestRecord(claudeHome);
  claude = readClaudeFile(claudeHome);
  range = markerRange(claude.content);
  const manifest = record.manifest;
  const before = claude.content.slice(0, range.start);
  const after = claude.content.slice(range.end);
  if (
    !before.endsWith(manifest.policy.prefix)
    || !after.startsWith(manifest.policy.suffix)
  ) {
    throw fail("invalid managed Claude policy placement", "drifted_policy");
  }
  const restored = `${before.slice(0, before.length - manifest.policy.prefix.length)}${after.slice(manifest.policy.suffix.length)}`;

  try {
    const pending = rollingBackManifest(manifest);
    writeAtomically(manifestFile(claudeHome), `${JSON.stringify(pending, null, 2)}\n`);
    if (!manifest.policy.hadClaudeFile && restored.length === 0) {
      fs.rmSync(claudeFile(claudeHome));
    } else {
      writeAtomically(claudeFile(claudeHome), restored);
    }
    removeManifest(claudeHome);
    log("rolled_back");
  } catch (error) {
    log("rollback_failed");
    throw error;
  }
}

function parseCli(args) {
  const actionFlags = new Set(["--install", "--verify", "--rollback"]);
  const actions = args.filter(argument => actionFlags.has(argument));
  if (actions.length !== 1) throw fail("use exactly one action", "invalid_arguments");

  const homeIndexes = args.reduce(
    (indexes, value, index) => value === "--claude-home" ? [...indexes, index] : indexes,
    []
  );
  if (homeIndexes.length > 1) {
    throw fail("--claude-home may be supplied once", "invalid_arguments");
  }
  const homeIndex = homeIndexes[0];
  if (
    homeIndex !== undefined
    && (!args[homeIndex + 1] || args[homeIndex + 1].startsWith("--"))
  ) {
    throw fail("--claude-home requires a directory", "invalid_arguments");
  }

  const accepted = new Set(actions);
  if (homeIndex !== undefined) {
    accepted.add("--claude-home");
    accepted.add(args[homeIndex + 1]);
  }
  if (args.some(argument => !accepted.has(argument))) {
    throw fail("unsupported argument", "invalid_arguments");
  }
  return {
    action: actions[0],
    claudeHome: homeIndex === undefined ? path.join(os.homedir(), ".claude") : args[homeIndex + 1]
  };
}

function main(args) {
  const {action, claudeHome} = parseCli(args);
  if (action === "--install") {
    const {manifest} = installClaudePolicy({claudeHome});
    installHarnessRuntime({sourceRoot: SOURCE_ROOT});
    console.log(JSON.stringify({installed: true, frameworkVersion: manifest.frameworkVersion}));
  } else if (action === "--verify") {
    const verification = verifyClaudePolicy({claudeHome, logResult: false});
    const runtime = verifyHarnessRuntime({sourceRoot: SOURCE_ROOT});
    if (!verification.valid || !runtime.valid) {
      throw fail("Claude policy drift detected", "drifted_policy");
    }
    console.log(JSON.stringify(verification, null, 2));
  } else {
    rollbackClaudePolicy({claudeHome});
  }
}

function commandErrorCode(error) {
  return error instanceof AdapterError ? error.code : "operation_failed";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    log("command_failed", {code: commandErrorCode(error)});
    process.exitCode = 1;
  }
}
