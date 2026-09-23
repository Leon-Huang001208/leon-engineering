import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_NAME = ".leon-engineering-harness-runtime.json";
export const HARNESS_RUNTIME_FILES = [
  "harness-runtime.mjs",
  "harness-storage.mjs",
  "harness-project.mjs",
  "harness-execution.mjs",
  "harness-run.mjs",
  "harness-session.mjs",
  "harness-enforce.mjs",
  "iteration-delivery.mjs",
  "harness-hook.mjs",
  "harness-evaluate.mjs",
  "verification-plan.mjs",
  "harness-control.mjs",
  "profile-project.mjs"
];

export function defaultHarnessRuntimeRoot() {
  return path.join(os.homedir(), ".agents", "leon-engineering", "runtime");
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function frameworkVersion(sourceRoot) {
  return JSON.parse(fs.readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
}

function sourceCommit(sourceRoot) {
  return execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
}

function defaultCanonicalSourceRoot() {
  const plugin = path.join(MODULE_ROOT, ".claude-plugin", "plugin.json");
  const scripts = path.join(MODULE_ROOT, "scripts");
  if (!fs.existsSync(plugin) || !fs.existsSync(scripts)) return null;
  return fs.realpathSync(MODULE_ROOT);
}

function requireCanonicalSourceRoot(sourceRoot) {
  if (typeof sourceRoot !== "string" || sourceRoot.trim().length === 0) {
    throw new Error("canonical runtime source is required");
  }
  const root = fs.realpathSync(path.resolve(sourceRoot));
  frameworkVersion(root);
  return root;
}

function ensureSafeDirectory(directory) {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) throw new Error("runtime directory cannot be a symbolic link");
    if (!stat.isDirectory()) throw new Error("runtime path is not a directory");
    return resolved;
  }
  fs.mkdirSync(resolved, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error("runtime directory cannot be a symbolic link");
  if (!stat.isDirectory()) throw new Error("runtime path is not a directory");
  return resolved;
}

function sourceFiles(sourceRoot) {
  return Object.fromEntries(HARNESS_RUNTIME_FILES.map(name => {
    const file = path.join(sourceRoot, "scripts", name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`invalid canonical runtime file: ${name}`);
    const content = fs.readFileSync(file);
    return [name, {content, checksum: checksum(content)}];
  }));
}

function writeAtomically(destination, content) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function readManifest(runtimeRoot) {
  const file = path.join(runtimeRoot, MANIFEST_NAME);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("invalid runtime manifest");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("invalid runtime manifest");
  }
  if (manifest.schemaVersion !== 1 || manifest.adapter !== "leon-engineering" || !manifest.files || typeof manifest.files !== "object") {
    throw new Error("invalid runtime manifest");
  }
  if (manifest.sourceRoot !== undefined && (typeof manifest.sourceRoot !== "string" || !path.isAbsolute(manifest.sourceRoot))) {
    throw new Error("invalid runtime manifest");
  }
  return manifest;
}

export function installHarnessRuntime({sourceRoot = defaultCanonicalSourceRoot(), runtimeRoot = defaultHarnessRuntimeRoot()} = {}) {
  const canonicalRoot = requireCanonicalSourceRoot(sourceRoot);
  const root = ensureSafeDirectory(runtimeRoot);
  const existing = readManifest(root);
  const entries = fs.readdirSync(root).filter(name => name !== MANIFEST_NAME);
  if (!existing && entries.length > 0) throw new Error("foreign runtime directory");
  const files = sourceFiles(canonicalRoot);
  for (const name of HARNESS_RUNTIME_FILES) writeAtomically(path.join(root, name), files[name].content);
  const manifest = {
    schemaVersion: 1,
    adapter: "leon-engineering",
    frameworkVersion: frameworkVersion(canonicalRoot),
    sourceCommit: sourceCommit(canonicalRoot),
    sourceRoot: canonicalRoot,
    files: Object.fromEntries(HARNESS_RUNTIME_FILES.map(name => [name, files[name].checksum]))
  };
  writeAtomically(path.join(root, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return {runtimeRoot: root, files: HARNESS_RUNTIME_FILES, manifest};
}

export function verifyHarnessRuntime({sourceRoot, runtimeRoot = defaultHarnessRuntimeRoot()} = {}) {
  const root = path.resolve(runtimeRoot);
  if (!fs.existsSync(root)) return {valid: false, drift: ["missing runtime directory"]};
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error("runtime directory cannot be a symbolic link");
  if (!stat.isDirectory()) throw new Error("runtime path is not a directory");
  const manifest = readManifest(root);
  if (!manifest) return {valid: false, drift: ["missing runtime manifest"]};
  const candidateSource = sourceRoot ?? defaultCanonicalSourceRoot() ?? manifest.sourceRoot;
  let files = null;
  const sourceDrift = [];
  try {
    files = sourceFiles(requireCanonicalSourceRoot(candidateSource));
  } catch {
    sourceDrift.push("canonical source unavailable");
  }
  const drift = HARNESS_RUNTIME_FILES.filter(name => {
    const destination = path.join(root, name);
    if (!fs.existsSync(destination)) return true;
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) return true;
    const installedChecksum = checksum(fs.readFileSync(destination));
    return installedChecksum !== manifest.files[name] || (files && installedChecksum !== files[name].checksum);
  });
  const combined = [...sourceDrift, ...drift];
  return {valid: combined.length === 0, drift: combined};
}

function parseArgs(args) {
  const actions = args.filter(item => item === "--install" || item === "--verify");
  if (actions.length !== 1) throw new Error("use exactly one of --install or --verify");
  const index = args.indexOf("--runtime-root");
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith("--"))) throw new Error("--runtime-root requires a directory");
  const accepted = new Set([actions[0]]);
  if (index >= 0) { accepted.add("--runtime-root"); accepted.add(args[index + 1]); }
  if (args.some(item => !accepted.has(item))) throw new Error("unsupported argument");
  return {action: actions[0], runtimeRoot: index >= 0 ? args[index + 1] : defaultHarnessRuntimeRoot()};
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.action === "--install" ? installHarnessRuntime(options) : verifyHarnessRuntime(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid && options.action === "--verify") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`harness runtime failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
