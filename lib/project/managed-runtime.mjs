import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

import {safeProjectRoot} from "../verification/path-safety.mjs";

const RUNTIME_RELATIVE = path.join(".agents", "runtime", "leon-engineering");
const MANIFEST_NAME = "manifest.json";
const ADAPTER = "leon-engineering-project-runtime";
const PROJECT_RUNTIME_FILES = [
  ...[
    "binding.mjs", "changed-files.mjs", "errors.mjs", "index.mjs", "path-safety.mjs", "planner.mjs", "policy.mjs", "receipt.mjs",
  ].map(name => `lib/verification/${name}`),
  ...[
    "verification-policy-v3.schema.json", "verification-plan-v3.schema.json", "verification-receipt-v2.schema.json",
  ].map(name => `schemas/${name}`),
];

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sourceIdentity(sourceRoot) {
  const root = safeProjectRoot(sourceRoot);
  const plugin = path.join(root, ".claude-plugin", "plugin.json");
  const metadata = fs.lstatSync(plugin);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("invalid framework source");
  const frameworkVersion = JSON.parse(fs.readFileSync(plugin, "utf8")).version;
  const sourceCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return {root, frameworkVersion, sourceCommit};
}

function sourceBundle(sourceRoot) {
  const identity = sourceIdentity(sourceRoot);
  const files = {};
  for (const relative of PROJECT_RUNTIME_FILES) {
    const destination = path.join(identity.root, relative);
    const metadata = fs.lstatSync(destination);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`invalid project runtime source: ${relative}`);
    const content = fs.readFileSync(destination);
    files[relative] = {content, sha256: sha256(content)};
  }
  return {...identity, files};
}

function manifestFor(bundle) {
  return {
    schemaVersion: 1,
    adapter: ADAPTER,
    frameworkVersion: bundle.frameworkVersion,
    sourceCommit: bundle.sourceCommit,
    protocols: {policy: 3, plan: 3, receipt: 2},
    files: Object.fromEntries(Object.entries(bundle.files).map(([relative, file]) => [relative, file.sha256])),
  };
}

function assertDirectory(directory, {create = false} = {}) {
  if (!fs.existsSync(directory)) {
    if (!create) throw new Error("directory is unavailable");
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  }
  const metadata = fs.lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("runtime directory must be a real directory");
  return directory;
}

function assertRuntimeParents(projectRoot, {create = false} = {}) {
  let current = projectRoot;
  for (const component of [".agents", "runtime"]) {
    current = path.join(current, component);
    let metadata;
    try {
      metadata = fs.lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (!create) return;
      fs.mkdirSync(current, {mode: 0o700});
      metadata = fs.lstatSync(current);
    }
    if (metadata.isSymbolicLink()) throw new Error("project runtime parent cannot be a symbolic link");
    if (!metadata.isDirectory()) throw new Error("project runtime parent must be a directory");
  }
}

function writeFile(destination, content) {
  fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
  fs.writeFileSync(destination, content, {mode: 0o600});
}

function readManifest(runtimeRoot) {
  const file = path.join(runtimeRoot, MANIFEST_NAME);
  if (!fs.existsSync(file)) throw new Error("project runtime manifest is missing");
  const metadata = fs.lstatSync(file);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("invalid project runtime manifest");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("invalid project runtime manifest");
  }
  if (manifest?.schemaVersion !== 1 || manifest.adapter !== ADAPTER ||
      typeof manifest.frameworkVersion !== "string" || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? "") ||
      !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    throw new Error("invalid project runtime manifest");
  }
  for (const [relative, digest] of Object.entries(manifest.files)) {
    if (!PROJECT_RUNTIME_FILES.includes(relative) || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error("invalid project runtime manifest");
    }
  }
  if (Object.keys(manifest.files).length !== PROJECT_RUNTIME_FILES.length) throw new Error("invalid project runtime manifest");
  return manifest;
}

function walkFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error("project runtime contains a symbolic link");
    if (entry.isDirectory()) files.push(...walkFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
    else throw new Error("project runtime contains an unsupported entry");
  }
  return files;
}

function verifyTree(runtimeRoot, manifest, bundle = null) {
  const drift = [];
  let actual;
  try {
    actual = walkFiles(runtimeRoot);
  } catch (error) {
    return [error.message];
  }
  const expected = [...PROJECT_RUNTIME_FILES, MANIFEST_NAME].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) drift.push("runtime file inventory");
  for (const relative of PROJECT_RUNTIME_FILES) {
    const destination = path.join(runtimeRoot, relative);
    if (!fs.existsSync(destination)) {
      drift.push(relative);
      continue;
    }
    const metadata = fs.lstatSync(destination);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      drift.push(relative);
      continue;
    }
    const digest = sha256(fs.readFileSync(destination));
    if (digest !== manifest.files[relative] || (bundle && digest !== bundle.files[relative].sha256)) drift.push(relative);
  }
  if (bundle && (manifest.frameworkVersion !== bundle.frameworkVersion || manifest.sourceCommit !== bundle.sourceCommit)) {
    drift.push("framework identity");
  }
  return [...new Set(drift)];
}

function gitCommonRoot(projectRoot) {
  const relative = execFileSync("git", ["-C", projectRoot, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return assertDirectory(path.resolve(projectRoot, relative));
}

function privateState(projectRoot) {
  const root = path.join(gitCommonRoot(projectRoot), "leon-engineering", "project-runtime");
  assertDirectory(root, {create: true});
  fs.chmodSync(root, 0o700);
  return root;
}

function receiptFile(projectRoot) {
  const directory = path.join(privateState(projectRoot), "receipts");
  assertDirectory(directory, {create: true});
  return path.join(directory, `${crypto.randomUUID()}.json`);
}

function writeReceipt(destination, receipt) {
  if (fs.existsSync(destination)) throw new Error("project runtime receipt already exists");
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function previewProjectRuntime({sourceRoot, projectRoot}) {
  const root = safeProjectRoot(projectRoot);
  const bundle = sourceBundle(sourceRoot);
  assertRuntimeParents(root);
  const runtimeRoot = path.join(root, RUNTIME_RELATIVE);
  if (!fs.existsSync(runtimeRoot)) return {valid: true, action: "install", runtimeRoot, conflicts: [], manifest: manifestFor(bundle)};
  const metadata = fs.lstatSync(runtimeRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    return {valid: false, action: "blocked", runtimeRoot, conflicts: ["foreign runtime target"], manifest: null};
  }
  let manifest;
  try {
    manifest = readManifest(runtimeRoot);
  } catch (error) {
    return {valid: false, action: "blocked", runtimeRoot, conflicts: [error.message], manifest: null};
  }
  const ownedDrift = verifyTree(runtimeRoot, manifest);
  if (ownedDrift.length > 0) return {valid: false, action: "blocked", runtimeRoot, conflicts: ownedDrift, manifest};
  const sourceDrift = verifyTree(runtimeRoot, manifest, bundle);
  return {
    valid: true,
    action: sourceDrift.length === 0 ? "unchanged" : "upgrade",
    runtimeRoot,
    conflicts: [],
    manifest: manifestFor(bundle),
  };
}

export function verifyProjectRuntime({sourceRoot, projectRoot}) {
  const root = safeProjectRoot(projectRoot);
  const runtimeRoot = path.join(root, RUNTIME_RELATIVE);
  if (!fs.existsSync(runtimeRoot)) return {valid: false, drift: ["missing project runtime"], runtimeRoot};
  try {
    const manifest = readManifest(runtimeRoot);
    const bundle = sourceRoot ? sourceBundle(sourceRoot) : null;
    const drift = verifyTree(runtimeRoot, manifest, bundle);
    return {valid: drift.length === 0, drift, runtimeRoot, manifest};
  } catch (error) {
    return {valid: false, drift: [error.message], runtimeRoot};
  }
}

export function applyProjectRuntime({sourceRoot, projectRoot}, dependencies = {}) {
  const root = safeProjectRoot(projectRoot);
  const preview = previewProjectRuntime({sourceRoot, projectRoot: root});
  if (!preview.valid) throw new Error(`managed runtime drift: ${preview.conflicts.join(", ")}`);
  if (preview.action === "unchanged") return {status: "unchanged", runtimeRoot: preview.runtimeRoot, manifest: preview.manifest};
  const bundle = sourceBundle(sourceRoot);
  assertRuntimeParents(root, {create: true});
  const parent = assertDirectory(path.dirname(preview.runtimeRoot));
  const staging = path.join(parent, `.leon-engineering-stage-${crypto.randomUUID()}`);
  const manifest = manifestFor(bundle);
  let backupRoot = null;
  let receiptPath = null;
  let promoted = false;
  try {
    assertDirectory(staging, {create: true});
    for (const [relative, file] of Object.entries(bundle.files)) writeFile(path.join(staging, relative), file.content);
    writeFile(path.join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    const stagedDrift = verifyTree(staging, readManifest(staging), bundle);
    if (stagedDrift.length > 0) throw new Error(`staged runtime drift: ${stagedDrift.join(", ")}`);
    dependencies.beforePromote?.({staging, runtimeRoot: preview.runtimeRoot});
    if (preview.action === "upgrade") {
      backupRoot = path.join(privateState(root), "backups", crypto.randomUUID());
      assertDirectory(path.dirname(backupRoot), {create: true});
      fs.renameSync(preview.runtimeRoot, backupRoot);
    }
    fs.renameSync(staging, preview.runtimeRoot);
    promoted = true;
    receiptPath = receiptFile(root);
    const receipt = {
      schemaVersion: 1,
      adapter: ADAPTER,
      status: "active",
      projectRoot: root,
      runtimeRoot: preview.runtimeRoot,
      backupRoot,
      appliedManifestSha256: sha256(`${JSON.stringify(manifest, null, 2)}\n`),
      manifest,
    };
    dependencies.beforeReceipt?.(receipt);
    writeReceipt(receiptPath, receipt);
    return {status: preview.action === "install" ? "installed" : "upgraded", runtimeRoot: preview.runtimeRoot, receiptPath, manifest};
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, {recursive: true, force: true});
    if (promoted && fs.existsSync(preview.runtimeRoot)) {
      if (backupRoot && fs.existsSync(backupRoot)) {
        const failedRuntime = `${preview.runtimeRoot}.failed-${crypto.randomUUID()}`;
        fs.renameSync(preview.runtimeRoot, failedRuntime);
        try {
          fs.renameSync(backupRoot, preview.runtimeRoot);
        } finally {
          fs.rmSync(failedRuntime, {recursive: true, force: true});
        }
      } else {
        fs.rmSync(preview.runtimeRoot, {recursive: true, force: true});
      }
    } else if (backupRoot && fs.existsSync(backupRoot) && !fs.existsSync(preview.runtimeRoot)) {
      fs.renameSync(backupRoot, preview.runtimeRoot);
    }
    if (receiptPath && fs.existsSync(receiptPath)) fs.rmSync(receiptPath, {force: true});
    throw error;
  }
}

function readReceipt(projectRoot, receiptPath) {
  const stateRoot = privateState(projectRoot);
  const candidate = fs.realpathSync(receiptPath);
  if (candidate !== stateRoot && !candidate.startsWith(`${stateRoot}${path.sep}`)) throw new Error("unsafe project runtime receipt");
  const metadata = fs.lstatSync(receiptPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("invalid project runtime receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt?.schemaVersion !== 1 || receipt.adapter !== ADAPTER || receipt.projectRoot !== projectRoot || receipt.status !== "active") {
    throw new Error("invalid project runtime receipt");
  }
  const expectedRuntime = path.join(projectRoot, RUNTIME_RELATIVE);
  if (receipt.runtimeRoot !== expectedRuntime) throw new Error("invalid project runtime receipt");
  if (receipt.backupRoot !== null) {
    const backupParent = path.join(stateRoot, "backups");
    if (typeof receipt.backupRoot !== "string" || !receipt.backupRoot.startsWith(`${backupParent}${path.sep}`)) {
      throw new Error("invalid project runtime receipt");
    }
    const backupMetadata = fs.lstatSync(receipt.backupRoot);
    if (backupMetadata.isSymbolicLink() || !backupMetadata.isDirectory()) throw new Error("invalid project runtime backup");
  }
  return receipt;
}

export function rollbackProjectRuntime({projectRoot, receiptPath}) {
  const root = safeProjectRoot(projectRoot);
  const receipt = readReceipt(root, receiptPath);
  const currentManifest = readManifest(receipt.runtimeRoot);
  const currentManifestContent = `${JSON.stringify(currentManifest, null, 2)}\n`;
  if (sha256(currentManifestContent) !== receipt.appliedManifestSha256 || verifyTree(receipt.runtimeRoot, currentManifest).length > 0) {
    throw new Error("runtime drift prevents rollback");
  }
  if (receipt.backupRoot !== null) {
    if (fs.existsSync(receipt.backupRoot) === false || fs.existsSync(`${receipt.runtimeRoot}.rollback`)) {
      throw new Error("rollback backup is unavailable");
    }
    const temporary = `${receipt.runtimeRoot}.rollback`;
    fs.renameSync(receipt.runtimeRoot, temporary);
    try {
      fs.renameSync(receipt.backupRoot, receipt.runtimeRoot);
      fs.rmSync(temporary, {recursive: true, force: true});
    } catch (error) {
      if (!fs.existsSync(receipt.runtimeRoot) && fs.existsSync(temporary)) fs.renameSync(temporary, receipt.runtimeRoot);
      throw error;
    }
  } else {
    fs.rmSync(receipt.runtimeRoot, {recursive: true});
  }
  const rolledBack = {...receipt, status: "rolled_back"};
  fs.writeFileSync(receiptPath, `${JSON.stringify(rolledBack, null, 2)}\n`, {mode: 0o600});
  return rolledBack;
}

export {PROJECT_RUNTIME_FILES};
