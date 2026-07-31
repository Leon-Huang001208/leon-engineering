import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const MANIFEST_NAME = ".leon-engineering.json";
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SKILL_NAMES = [
  "agent-routing",
  "bugfix-evidence",
  "feature-loop",
  "logging-observability",
  "project-bootstrap",
  "review-ship",
  "skill-health"
];

function log(event, details = {}) {
  console.error(JSON.stringify({component: "codex-adapter", event, ...details}));
}

function listSkillFiles(directory, name, source) {
  if (!fs.existsSync(directory)) {
    throw new Error(`${source ? "missing canonical skill" : "missing installed skill"}: ${name}`);
  }

  const files = [];
  function visit(relativeDirectory) {
    const absoluteDirectory = path.join(directory, relativeDirectory);
    const entries = fs.readdirSync(absoluteDirectory, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const absolute = path.join(directory, relative);
      if (entry.isDirectory()) {
        visit(relative);
      } else if (entry.isFile()) {
        files.push({absolute, relative: relative.split(path.sep).join("/")});
      } else {
        throw new Error(`unsupported skill entry: ${name}/${relative}`);
      }
    }
  }

  visit("");
  if (!files.some(file => file.relative === "SKILL.md")) {
    throw new Error(`${source ? "missing canonical skill" : "missing installed skill"}: ${name}`);
  }
  return files;
}

function canonicalSkillFiles(sourceRoot, name) {
  return listSkillFiles(path.join(sourceRoot, "skills", name), name, true);
}

function skillChecksum(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(fs.readFileSync(file.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function manifestPath(targetRoot) {
  return path.join(targetRoot, MANIFEST_NAME);
}

function assertOwnedSkillNames(skills) {
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    throw new Error("invalid adapter manifest");
  }
  for (const [name, checksum] of Object.entries(skills)) {
    if (!SKILL_NAMES.includes(name) || !/^[0-9a-f]{64}$/.test(checksum)) {
      throw new Error("invalid adapter manifest");
    }
  }
}

function readManifest(targetRoot) {
  const file = manifestPath(targetRoot);
  if (!fs.existsSync(file)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid adapter manifest: ${error.message}`);
  }

  if (manifest.adapter !== "leon-engineering" || manifest.schemaVersion !== 1) {
    throw new Error("invalid adapter manifest");
  }
  assertOwnedSkillNames(manifest.skills);
  return manifest;
}

function sourceCommit(sourceRoot) {
  try {
    return execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  } catch (error) {
    throw new Error(`cannot read source commit: ${error.message}`);
  }
}

function frameworkVersion(sourceRoot) {
  try {
    const file = path.join(sourceRoot, ".claude-plugin", "plugin.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).version;
  } catch (error) {
    throw new Error(`cannot read framework version: ${error.message}`);
  }
}

function preflight(sourceRoot, targetRoot, existing) {
  for (const name of SKILL_NAMES) canonicalSkillFiles(sourceRoot, name);
  for (const name of SKILL_NAMES) {
    const target = path.join(targetRoot, name);
    if (fs.existsSync(target) && !existing?.skills?.[name]) {
      throw new Error(`foreign skill directory: ${name}`);
    }
  }
}

function writeAtomically(destination, content) {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`
  );
  fs.writeFileSync(temporary, content, {mode: 0o600});
  fs.renameSync(temporary, destination);
}

export function install({sourceRoot = SOURCE_ROOT, targetRoot}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  fs.mkdirSync(targetRoot, {recursive: true});

  const existing = readManifest(targetRoot);
  preflight(sourceRoot, targetRoot, existing);

  const staging = fs.mkdtempSync(path.join(targetRoot, ".leon-engineering-stage-"));
  try {
    const skills = {};
    for (const name of SKILL_NAMES) {
      const files = canonicalSkillFiles(sourceRoot, name);
      for (const file of files) {
        const staged = path.join(staging, name, file.relative);
        fs.mkdirSync(path.dirname(staged), {recursive: true});
        fs.copyFileSync(file.absolute, staged);
      }
      skills[name] = skillChecksum(files);
    }

    for (const name of SKILL_NAMES) {
      for (const file of listSkillFiles(path.join(staging, name), name, false)) {
        const destination = path.join(targetRoot, name, file.relative);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        writeAtomically(destination, fs.readFileSync(file.absolute));
      }
    }

    const manifest = {
      schemaVersion: 1,
      adapter: "leon-engineering",
      frameworkVersion: frameworkVersion(sourceRoot),
      sourceCommit: sourceCommit(sourceRoot),
      skills
    };
    writeAtomically(manifestPath(targetRoot), `${JSON.stringify(manifest, null, 2)}\n`);
    log("installed", {skillCount: SKILL_NAMES.length});
    return {skills: SKILL_NAMES, manifest};
  } catch (error) {
    log("install_failed", {message: error.message});
    throw error;
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

export function verify({sourceRoot = SOURCE_ROOT, targetRoot}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  const manifest = readManifest(targetRoot);
  if (!manifest) throw new Error("adapter manifest not found");

  const drift = SKILL_NAMES.filter(name => {
    try {
      const sourceChecksum = skillChecksum(canonicalSkillFiles(sourceRoot, name));
      const installedChecksum = skillChecksum(
        listSkillFiles(path.join(targetRoot, name), name, false)
      );
      return sourceChecksum !== installedChecksum || manifest.skills[name] !== installedChecksum;
    } catch {
      return true;
    }
  });
  log("verified", {valid: drift.length === 0, driftCount: drift.length});
  return {valid: drift.length === 0, drift};
}

export function rollback({targetRoot}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  const manifest = readManifest(targetRoot);
  if (!manifest) throw new Error("adapter manifest not found");

  for (const name of Object.keys(manifest.skills)) {
    fs.rmSync(path.join(targetRoot, name), {recursive: true, force: true});
  }
  fs.rmSync(manifestPath(targetRoot), {force: true});
  log("rolled_back", {skillCount: Object.keys(manifest.skills).length});
}

function main(args) {
  const targetIndex = args.indexOf("--target");
  if (targetIndex >= 0 && !args[targetIndex + 1]) throw new Error("--target requires a directory");
  const targetRoot = targetIndex >= 0
    ? args[targetIndex + 1]
    : path.join(os.homedir(), ".codex", "skills");

  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({targetRoot, skills: SKILL_NAMES}, null, 2));
    return;
  }
  if (args.includes("--install")) {
    console.log(JSON.stringify(install({targetRoot}), null, 2));
    return;
  }
  if (args.includes("--verify")) {
    console.log(JSON.stringify(verify({targetRoot}), null, 2));
    return;
  }
  if (args.includes("--rollback")) {
    rollback({targetRoot});
    return;
  }
  throw new Error("use --dry-run, --install, --verify, or --rollback");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    log("command_failed", {message: error.message});
    process.exitCode = 1;
  }
}
