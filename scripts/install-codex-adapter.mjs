import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {defaultHarnessRuntimeRoot, installHarnessRuntime, verifyHarnessRuntime} from "./harness-runtime.mjs";
import {REASONING_SKILL_NAMES} from "./reasoning-skills.mjs";

const MANIFEST_NAME = ".leon-engineering.json";
const DISTRIBUTION_MANIFEST_NAME = ".leon-engineering-distribution.json";
const GLOBAL_MANIFEST_NAME = ".leon-engineering-global.json";
const GLOBAL_HOOKS_NAME = "hooks.json";
const RUNTIME_ROOT_PLACEHOLDER = "__LEON_ENGINEERING_RUNTIME_ROOT__";
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_POLICY_START = "<!-- leon-engineering:global-framework:start -->";
const GLOBAL_POLICY_END = "<!-- leon-engineering:global-framework:end -->";

export const CORE_SKILL_NAMES = Object.freeze([
  "agent-routing",
  "bugfix-evidence",
  "feature-loop",
  "iteration-delivery",
  "project-adapter",
  "project-bootstrap",
  "project-constraints",
  "project-harness",
  "review-ship"
]);

export const EXTENDED_SKILL_NAMES = Object.freeze([
  "logging-observability",
  "skill-health",
  ...REASONING_SKILL_NAMES
]);

export const SKILL_NAMES = Object.freeze([...CORE_SKILL_NAMES, ...EXTENDED_SKILL_NAMES]);

export const GLOBAL_DOCUMENT_NAMES = [
  "GETTING_STARTED.md",
  "STRUCTURE.md",
  "COMMANDS_GUIDE.md",
  "SKILLS_GUIDE.md",
  "AGENTS_GUIDE.md",
  "SETTINGS_GUIDE.md"
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
  const family = CORE_SKILL_NAMES.includes(name) ? "leon-engineering-core" : "leon-engineering-workflows";
  return listSkillFiles(path.join(sourceRoot, "plugins", family, "skills", name), name, true);
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

function textChecksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function manifestPath(targetRoot) {
  return path.join(targetRoot, MANIFEST_NAME);
}

function distributionManifestPath(targetRoot) {
  return path.join(targetRoot, DISTRIBUTION_MANIFEST_NAME);
}

function globalManifestPath(codexHome) {
  return path.join(codexHome, GLOBAL_MANIFEST_NAME);
}

function globalAgentsPath(codexHome) {
  return path.join(codexHome, "AGENTS.md");
}

function globalDocsPath(codexHome) {
  return path.join(codexHome, "docs");
}

function globalHooksPath(codexHome) {
  return path.join(codexHome, GLOBAL_HOOKS_NAME);
}

function canonicalGlobalPolicy(sourceRoot) {
  const files = [
    path.join(sourceRoot, "adapters", "shared", "global-policy.md"),
    path.join(sourceRoot, "adapters", "codex", "global-policy.md")
  ];
  if (files.some(file => !fs.existsSync(file))) throw new Error("missing canonical global policy");
  const content = files.map(file => fs.readFileSync(file, "utf8").trim()).join("\n\n");
  if (!content || content.includes(GLOBAL_POLICY_START) || content.includes(GLOBAL_POLICY_END)) {
    throw new Error("invalid canonical global policy");
  }
  return content;
}

function canonicalGlobalDocuments(sourceRoot) {
  const documents = {};
  for (const name of GLOBAL_DOCUMENT_NAMES) {
    const file = path.join(sourceRoot, "adapters", "codex", "global-docs", name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`missing canonical global document: ${name}`);
    }
    documents[name] = fs.readFileSync(file, "utf8");
  }
  return documents;
}

function canonicalGlobalHooks(sourceRoot) {
  const file = path.join(sourceRoot, "adapters", "codex", GLOBAL_HOOKS_NAME);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("missing canonical global hooks");
  const template = fs.readFileSync(file, "utf8");
  if (!template.includes(RUNTIME_ROOT_PLACEHOLDER)) throw new Error("invalid canonical global hooks");
  const content = template.replaceAll(RUNTIME_ROOT_PLACEHOLDER, defaultHarnessRuntimeRoot());
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("invalid canonical global hooks");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.hooks || typeof parsed.hooks !== "object") {
    throw new Error("invalid canonical global hooks");
  }
  return content;
}

function markerRange(content) {
  const start = content.indexOf(GLOBAL_POLICY_START);
  const end = content.indexOf(GLOBAL_POLICY_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error("invalid global policy markers");
  }
  if (start === -1) return null;
  if (
    content.indexOf(GLOBAL_POLICY_START, start + GLOBAL_POLICY_START.length) !== -1
    || content.indexOf(GLOBAL_POLICY_END, end + GLOBAL_POLICY_END.length) !== -1
  ) {
    throw new Error("invalid global policy markers");
  }
  return {start, end: end + GLOBAL_POLICY_END.length};
}

function renderPolicyBlock(policy) {
  return `${GLOBAL_POLICY_START}\n${policy}\n${GLOBAL_POLICY_END}`;
}

function assertGlobalDocumentChecksums(documents) {
  if (!documents || typeof documents !== "object" || Array.isArray(documents)) {
    throw new Error("invalid global framework manifest");
  }
  const names = Object.keys(documents).sort();
  if (JSON.stringify(names) !== JSON.stringify([...GLOBAL_DOCUMENT_NAMES].sort())) {
    throw new Error("invalid global framework manifest");
  }
  for (const checksum of Object.values(documents)) {
    if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error("invalid global framework manifest");
  }
}

function assertGlobalPolicyManifest(policy) {
  if (
    !policy
    || typeof policy !== "object"
    || !/^[0-9a-f]{64}$/.test(policy.checksum)
    || typeof policy.prefix !== "string"
    || typeof policy.suffix !== "string"
    || typeof policy.hadAgentsFile !== "boolean"
  ) {
    throw new Error("invalid global framework manifest");
  }
}

function assertGlobalHooksManifest(hooks) {
  if (hooks === undefined) return;
  if (
    !hooks
    || typeof hooks !== "object"
    || !/^[0-9a-f]{64}$/.test(hooks.checksum)
    || typeof hooks.hadHooksFile !== "boolean"
  ) {
    throw new Error("invalid global framework manifest");
  }
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

function readGlobalManifest(codexHome) {
  const file = globalManifestPath(codexHome);
  if (!fs.existsSync(file)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid global framework manifest: ${error.message}`);
  }

  if (manifest.adapter !== "leon-engineering" || manifest.schemaVersion !== 1) {
    throw new Error("invalid global framework manifest");
  }
  assertGlobalPolicyManifest(manifest.policy);
  assertGlobalDocumentChecksums(manifest.documents);
  assertGlobalHooksManifest(manifest.hooks);
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

function readExistingAgents(codexHome) {
  const file = globalAgentsPath(codexHome);
  if (!fs.existsSync(file)) return {content: "", hadFile: false};
  if (!fs.statSync(file).isFile()) throw new Error("global AGENTS.md is not a file");
  return {content: fs.readFileSync(file, "utf8"), hadFile: true};
}

function readExistingHooks(codexHome) {
  const file = globalHooksPath(codexHome);
  if (!fs.existsSync(file)) return {content: "", hadFile: false};
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("global hooks.json is not a file");
  return {content: fs.readFileSync(file, "utf8"), hadFile: true};
}

function isCanonicalHooksSubset(existingContent, canonicalContent) {
  let existing;
  let canonical;
  try {
    existing = JSON.parse(existingContent);
    canonical = JSON.parse(canonicalContent);
  } catch {
    return false;
  }
  if (
    !existing || typeof existing !== "object" || Array.isArray(existing)
    || existing.description !== canonical.description
    || !existing.hooks || typeof existing.hooks !== "object" || Array.isArray(existing.hooks)
  ) return false;
  const entries = Object.entries(existing.hooks);
  return entries.length > 0 && entries.every(([event, hooks]) => (
    Object.hasOwn(canonical.hooks, event)
    && JSON.stringify(hooks) === JSON.stringify(canonical.hooks[event])
  ));
}

function preflightGlobalFramework(sourceRoot, codexHome, existingManifest) {
  const policy = canonicalGlobalPolicy(sourceRoot);
  const documents = canonicalGlobalDocuments(sourceRoot);
  const hooks = canonicalGlobalHooks(sourceRoot);
  const agents = readExistingAgents(codexHome);
  const existingHooks = readExistingHooks(codexHome);
  const range = markerRange(agents.content);

  if (range && !existingManifest) {
    throw new Error("foreign global policy block");
  }
  if (existingManifest && !range) {
    throw new Error("missing managed global policy block");
  }
  if (
    existingManifest
    && range
    && textChecksum(agents.content.slice(range.start, range.end)) !== existingManifest.policy.checksum
  ) {
    throw new Error("drifted global policy block");
  }
  if (
    existingManifest?.hooks
    && existingHooks.hadFile
    && textChecksum(existingHooks.content) !== existingManifest.hooks.checksum
    && !isCanonicalHooksSubset(existingHooks.content, hooks)
  ) {
    throw new Error("drifted global hooks");
  }
  if (!existingManifest?.hooks && existingHooks.hadFile && existingHooks.content !== hooks) {
    throw new Error("foreign global hooks");
  }

  const docsRoot = globalDocsPath(codexHome);
  for (const name of GLOBAL_DOCUMENT_NAMES) {
    const destination = path.join(docsRoot, name);
    if (!fs.existsSync(destination)) continue;
    if (!fs.statSync(destination).isFile()) {
      throw new Error(`invalid global document target: ${name}`);
    }
    if (!existingManifest?.documents?.[name]) {
      throw new Error(`foreign global document: ${name}`);
    }
  }

  return {policy, documents, hooks, agents, existingHooks, range};
}

function installPolicyContent({agents, range, policy, existingManifest}) {
  const block = renderPolicyBlock(policy);
  if (range) {
    return {
      content: `${agents.content.slice(0, range.start)}${block}${agents.content.slice(range.end)}`,
      prefix: existingManifest.policy.prefix,
      suffix: existingManifest.policy.suffix,
      hadAgentsFile: existingManifest.policy.hadAgentsFile
    };
  }

  const prefix = agents.content.length === 0
    ? ""
    : agents.content.endsWith("\n") ? "\n" : "\n\n";
  const suffix = "\n";
  return {
    content: `${agents.content}${prefix}${block}${suffix}`,
    prefix,
    suffix,
    hadAgentsFile: agents.hadFile
  };
}

export function installGlobalFramework({sourceRoot = SOURCE_ROOT, codexHome}) {
  if (!codexHome) throw new Error("codexHome is required");
  fs.mkdirSync(codexHome, {recursive: true});

  const existingManifest = readGlobalManifest(codexHome);
  const prepared = preflightGlobalFramework(sourceRoot, codexHome, existingManifest);
  const installedPolicy = installPolicyContent({
    ...prepared,
    existingManifest
  });
  const documents = Object.fromEntries(
    Object.entries(prepared.documents).map(([name, content]) => [name, textChecksum(content)])
  );
  const manifest = {
    schemaVersion: 1,
    adapter: "leon-engineering",
    frameworkVersion: frameworkVersion(sourceRoot),
    sourceCommit: sourceCommit(sourceRoot),
    policy: {
      checksum: textChecksum(renderPolicyBlock(prepared.policy)),
      prefix: installedPolicy.prefix,
      suffix: installedPolicy.suffix,
      hadAgentsFile: installedPolicy.hadAgentsFile
    },
    documents,
    hooks: {
      checksum: textChecksum(prepared.hooks),
      hadHooksFile: existingManifest?.hooks
        ? existingManifest.hooks.hadHooksFile
        : prepared.existingHooks.hadFile
    }
  };

  try {
    const docsRoot = globalDocsPath(codexHome);
    fs.mkdirSync(docsRoot, {recursive: true});
    for (const [name, content] of Object.entries(prepared.documents)) {
      writeAtomically(path.join(docsRoot, name), content);
    }
    writeAtomically(globalHooksPath(codexHome), prepared.hooks);
    writeAtomically(globalAgentsPath(codexHome), installedPolicy.content);
    writeAtomically(globalManifestPath(codexHome), `${JSON.stringify(manifest, null, 2)}\n`);
    log("global_installed", {documentCount: GLOBAL_DOCUMENT_NAMES.length});
    return {documents: GLOBAL_DOCUMENT_NAMES, manifest};
  } catch (error) {
    log("global_install_failed", {message: error.message});
    throw error;
  }
}

export function verifyGlobalFramework({sourceRoot = SOURCE_ROOT, codexHome}) {
  if (!codexHome) throw new Error("codexHome is required");
  const manifest = readGlobalManifest(codexHome);
  if (!manifest) throw new Error("global framework manifest not found");

  const drift = [];
  try {
    const policy = canonicalGlobalPolicy(sourceRoot);
    const agents = readExistingAgents(codexHome);
    const range = markerRange(agents.content);
    const installed = range ? agents.content.slice(range.start, range.end) : "";
    const expected = renderPolicyBlock(policy);
    if (
      !range
      || textChecksum(installed) !== manifest.policy.checksum
      || installed !== expected
    ) {
      drift.push("policy");
    }
  } catch {
    drift.push("policy");
  }

  let sourceDocuments = {};
  try {
    sourceDocuments = canonicalGlobalDocuments(sourceRoot);
  } catch {
    for (const name of GLOBAL_DOCUMENT_NAMES) drift.push(`document:${name}`);
  }

  try {
    const sourceHooks = canonicalGlobalHooks(sourceRoot);
    const installedHooks = fs.readFileSync(globalHooksPath(codexHome), "utf8");
    if (
      !manifest.hooks
      || textChecksum(installedHooks) !== manifest.hooks.checksum
      || installedHooks !== sourceHooks
    ) {
      drift.push("hooks");
    }
  } catch {
    drift.push("hooks");
  }
  for (const name of GLOBAL_DOCUMENT_NAMES) {
    if (drift.includes(`document:${name}`)) continue;
    try {
      const installed = fs.readFileSync(path.join(globalDocsPath(codexHome), name), "utf8");
      if (
        textChecksum(installed) !== manifest.documents[name]
        || installed !== sourceDocuments[name]
      ) {
        drift.push(`document:${name}`);
      }
    } catch {
      drift.push(`document:${name}`);
    }
  }

  log("global_verified", {valid: drift.length === 0, driftCount: drift.length});
  return {valid: drift.length === 0, drift};
}

export function rollbackGlobalFramework({sourceRoot = SOURCE_ROOT, codexHome}) {
  if (!codexHome) throw new Error("codexHome is required");
  const manifest = readGlobalManifest(codexHome);
  if (!manifest) throw new Error("global framework manifest not found");
  const verification = verifyGlobalFramework({sourceRoot, codexHome});
  if (!verification.valid) throw new Error("refusing to rollback drifted global framework");

  const agentsFile = globalAgentsPath(codexHome);
  const agents = readExistingAgents(codexHome);
  const range = markerRange(agents.content);
  const before = agents.content.slice(0, range.start);
  const after = agents.content.slice(range.end);
  if (
    !before.endsWith(manifest.policy.prefix)
    || !after.startsWith(manifest.policy.suffix)
  ) {
    throw new Error("invalid managed global policy placement");
  }
  const restored = `${before.slice(0, before.length - manifest.policy.prefix.length)}${after.slice(manifest.policy.suffix.length)}`;

  try {
    for (const name of GLOBAL_DOCUMENT_NAMES) {
      fs.rmSync(path.join(globalDocsPath(codexHome), name));
    }
    try {
      fs.rmdirSync(globalDocsPath(codexHome));
    } catch (error) {
      if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
    }
    if (manifest.hooks && !manifest.hooks.hadHooksFile) fs.rmSync(globalHooksPath(codexHome));
    if (!manifest.policy.hadAgentsFile && restored.length === 0) {
      fs.rmSync(agentsFile);
    } else {
      writeAtomically(agentsFile, restored);
    }
    fs.rmSync(globalManifestPath(codexHome));
    log("global_rolled_back", {documentCount: GLOBAL_DOCUMENT_NAMES.length});
  } catch (error) {
    log("global_rollback_failed", {message: error.message});
    throw error;
  }
}

export function install({sourceRoot = SOURCE_ROOT, targetRoot, logResult = true}) {
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
    if (logResult) log("installed", {skillCount: SKILL_NAMES.length});
    return {skills: SKILL_NAMES, manifest};
  } catch (error) {
    if (logResult) log("install_failed", {message: error.message});
    throw error;
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

export function verify({sourceRoot = SOURCE_ROOT, targetRoot, logResult = true}) {
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
  if (logResult) log("verified", {valid: drift.length === 0, driftCount: drift.length});
  return {valid: drift.length === 0, drift};
}

export function rollback({targetRoot, logResult = true}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  const manifest = readManifest(targetRoot);
  if (!manifest) throw new Error("adapter manifest not found");

  const drift = Object.entries(manifest.skills).flatMap(([name, expectedChecksum]) => {
    try {
      const installedChecksum = skillChecksum(
        listSkillFiles(path.join(targetRoot, name), name, false)
      );
      return installedChecksum === expectedChecksum ? [] : [name];
    } catch {
      return [name];
    }
  });
  if (drift.length > 0) {
    throw new Error(`refusing to rollback drifted skills: ${drift.join(", ")}`);
  }

  for (const name of Object.keys(manifest.skills)) {
    fs.rmSync(path.join(targetRoot, name), {recursive: true, force: true});
  }
  fs.rmSync(manifestPath(targetRoot), {force: true});
  if (logResult) log("rolled_back", {skillCount: Object.keys(manifest.skills).length});
}

function readDistributionManifest(targetRoot) {
  const file = distributionManifestPath(targetRoot);
  if (!fs.existsSync(file)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid distribution manifest: ${error.message}`);
  }
  if (
    manifest?.schemaVersion !== 1
    || manifest.adapter !== "leon-engineering"
    || manifest.distribution !== "plugin-only"
    || typeof manifest.backupRoot !== "string"
    || !path.isAbsolute(manifest.backupRoot)
    || !manifest.retiredSkills
    || typeof manifest.retiredSkills !== "object"
    || Array.isArray(manifest.retiredSkills)
  ) throw new Error("invalid distribution manifest");
  for (const [name, checksum] of Object.entries(manifest.retiredSkills)) {
    if (!SKILL_NAMES.includes(name) || !/^[0-9a-f]{64}$/.test(checksum)) {
      throw new Error("invalid distribution manifest");
    }
  }
  const expectedParent = path.join(path.dirname(targetRoot), ".leon-engineering-backups");
  if (path.dirname(manifest.backupRoot) !== expectedParent) throw new Error("invalid distribution backup root");
  return manifest;
}

function installedManifestDrift(targetRoot, manifest) {
  return Object.entries(manifest.skills).flatMap(([name, expectedChecksum]) => {
    try {
      const installedChecksum = skillChecksum(listSkillFiles(path.join(targetRoot, name), name, false));
      return installedChecksum === expectedChecksum ? [] : [name];
    } catch {
      return [name];
    }
  });
}

export function migrateToPluginDistribution({sourceRoot = SOURCE_ROOT, targetRoot, logResult = true}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  if (readDistributionManifest(targetRoot)) throw new Error("plugin-only distribution already active");
  const existing = readManifest(targetRoot);
  if (!existing) throw new Error("adapter manifest not found");
  const drift = installedManifestDrift(targetRoot, existing);
  if (drift.length > 0) {
    throw new Error(`refusing to migrate drifted skills: ${drift.join(", ")}`);
  }

  const backupParent = path.join(path.dirname(targetRoot), ".leon-engineering-backups");
  const backupRoot = path.join(backupParent, crypto.randomUUID());
  fs.mkdirSync(backupRoot, {recursive: true, mode: 0o700});
  const retiredSkills = {};
  try {
    for (const [name, checksum] of Object.entries(existing.skills)) {
      const source = path.join(targetRoot, name);
      const destination = path.join(backupRoot, name);
      fs.cpSync(source, destination, {recursive: true, errorOnExist: true});
      const backupChecksum = skillChecksum(listSkillFiles(destination, name, false));
      if (backupChecksum !== checksum) throw new Error(`backup checksum mismatch: ${name}`);
      retiredSkills[name] = checksum;
    }
    for (const name of Object.keys(retiredSkills)) {
      fs.rmSync(path.join(targetRoot, name), {recursive: true});
    }
    const manifest = {
      schemaVersion: 1,
      adapter: "leon-engineering",
      distribution: "plugin-only",
      frameworkVersion: frameworkVersion(sourceRoot),
      sourceCommit: sourceCommit(sourceRoot),
      backupRoot,
      retiredSkills
    };
    writeAtomically(distributionManifestPath(targetRoot), `${JSON.stringify(manifest, null, 2)}\n`);
    if (logResult) log("plugin_distribution_migrated", {skillCount: Object.keys(retiredSkills).length});
    return {retiredSkills: Object.keys(retiredSkills), manifest};
  } catch (error) {
    for (const name of Object.keys(retiredSkills)) {
      const destination = path.join(targetRoot, name);
      if (!fs.existsSync(destination) && fs.existsSync(path.join(backupRoot, name))) {
        fs.cpSync(path.join(backupRoot, name), destination, {recursive: true});
      }
    }
    fs.rmSync(backupRoot, {recursive: true, force: true});
    throw error;
  }
}

export function verifyPluginDistribution({targetRoot, logResult = true}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  const manifest = readDistributionManifest(targetRoot);
  if (!manifest) throw new Error("distribution manifest not found");
  const drift = [];
  for (const [name, checksum] of Object.entries(manifest.retiredSkills)) {
    if (fs.existsSync(path.join(targetRoot, name))) drift.push(`restored:${name}`);
    try {
      const backup = path.join(manifest.backupRoot, name);
      const actual = skillChecksum(listSkillFiles(backup, name, false));
      if (actual !== checksum) drift.push(`backup:${name}`);
    } catch {
      drift.push(`backup:${name}`);
    }
  }
  if (logResult) log("plugin_distribution_verified", {valid: drift.length === 0, driftCount: drift.length});
  return {valid: drift.length === 0, drift};
}

export function rollbackPluginDistribution({targetRoot, logResult = true}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  const manifest = readDistributionManifest(targetRoot);
  if (!manifest) throw new Error("distribution manifest not found");
  const verification = verifyPluginDistribution({targetRoot, logResult: false});
  if (!verification.valid) throw new Error(`refusing to rollback drifted distribution: ${verification.drift.join(", ")}`);
  for (const name of Object.keys(manifest.retiredSkills)) {
    const destination = path.join(targetRoot, name);
    if (fs.existsSync(destination)) throw new Error(`refusing to overwrite restored skill: ${name}`);
    fs.cpSync(path.join(manifest.backupRoot, name), destination, {recursive: true});
  }
  fs.rmSync(distributionManifestPath(targetRoot));
  fs.rmSync(manifest.backupRoot, {recursive: true});
  try {
    fs.rmdirSync(path.dirname(manifest.backupRoot));
  } catch (error) {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  }
  if (logResult) log("plugin_distribution_rolled_back", {skillCount: Object.keys(manifest.retiredSkills).length});
}

function boundedVerification(run, fallback) {
  try {
    const result = run();
    return {
      valid: result.valid === true,
      drift: Array.isArray(result.drift) ? [...new Set(result.drift.map(String))] : [fallback]
    };
  } catch {
    return {valid: false, drift: [fallback]};
  }
}

export function verifyCurrentCodexState({
  sourceRoot = SOURCE_ROOT,
  targetRoot,
  codexHome,
  runtimeRoot = defaultHarnessRuntimeRoot(),
  explicitTarget = false
}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  if (!codexHome) throw new Error("codexHome is required");
  const distributionActive = fs.existsSync(distributionManifestPath(targetRoot));
  const pluginDistribution = boundedVerification(
    () => distributionActive
      ? verifyPluginDistribution({targetRoot, logResult: false})
      : explicitTarget
        ? verify({sourceRoot, targetRoot, logResult: false})
        : {valid: false, drift: ["distribution manifest"]},
    "distribution manifest"
  );
  const globalFramework = boundedVerification(
    () => verifyGlobalFramework({sourceRoot, codexHome}),
    "framework manifest"
  );
  const runtime = boundedVerification(
    () => verifyHarnessRuntime({sourceRoot, runtimeRoot}),
    "runtime verification"
  );
  const drift = [...new Set([
    ...pluginDistribution.drift.map(item => `plugin:${item}`),
    ...globalFramework.drift.map(item => `global:${item}`),
    ...runtime.drift.map(item => `runtime:${item}`)
  ])];
  return {
    valid: pluginDistribution.valid && globalFramework.valid && runtime.valid,
    drift,
    pluginDistribution,
    globalFramework,
    runtime
  };
}

function main(args) {
  const targetIndex = args.indexOf("--target");
  if (targetIndex >= 0 && !args[targetIndex + 1]) throw new Error("--target requires a directory");
  const codexHomeIndex = args.indexOf("--codex-home");
  if (codexHomeIndex >= 0 && !args[codexHomeIndex + 1]) {
    throw new Error("--codex-home requires a directory");
  }
  const runtimeRootIndex = args.indexOf("--runtime-root");
  if (runtimeRootIndex >= 0 && (!args[runtimeRootIndex + 1] || args[runtimeRootIndex + 1].startsWith("--"))) {
    throw new Error("--runtime-root requires a directory");
  }
  const codexHome = codexHomeIndex >= 0
    ? args[codexHomeIndex + 1]
    : path.join(os.homedir(), ".codex");
  const targetRoot = targetIndex >= 0
    ? args[targetIndex + 1]
    : path.join(codexHome, "skills");
  const runtimeRoot = runtimeRootIndex >= 0
    ? args[runtimeRootIndex + 1]
    : defaultHarnessRuntimeRoot();
  const globalActions = ["--install-global", "--verify-global", "--rollback-global"]
    .filter(action => args.includes(action));
  if (globalActions.length > 1) throw new Error("use only one global framework action");
  if (globalActions.length === 1 && targetIndex >= 0) {
    throw new Error("--target cannot be used with a global framework action");
  }

  if (args.includes("--install-global")) {
    const {documents, manifest} = installGlobalFramework({codexHome});
    installHarnessRuntime({sourceRoot: SOURCE_ROOT, runtimeRoot});
    console.log(JSON.stringify({
      installed: true,
      documents,
      frameworkVersion: manifest.frameworkVersion,
      activation: {
        status: "restart_required",
        scope: "codex_host_process",
        note: "New tasks created before the Codex host restarts may still use cached hooks."
      }
    }));
    return;
  }
  if (args.includes("--verify-global")) {
    const verification = verifyGlobalFramework({codexHome});
    const runtime = verifyHarnessRuntime({sourceRoot: SOURCE_ROOT, runtimeRoot});
    const result = {valid: verification.valid && runtime.valid, drift: [...verification.drift, ...runtime.drift.map(item => `runtime:${item}`)]};
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (args.includes("--rollback-global")) {
    rollbackGlobalFramework({codexHome});
    return;
  }

  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({targetRoot, skills: SKILL_NAMES}, null, 2));
    return;
  }
  if (args.includes("--install")) {
    console.log(JSON.stringify(install({targetRoot}), null, 2));
    return;
  }
  if (args.includes("--verify")) {
    const result = targetIndex >= 0
      ? verify({targetRoot})
      : verifyCurrentCodexState({
        targetRoot,
        codexHome,
        runtimeRoot,
        explicitTarget: false
      });
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (args.includes("--rollback")) {
    rollback({targetRoot});
    return;
  }
  if (args.includes("--migrate-plugin-only")) {
    console.log(JSON.stringify(migrateToPluginDistribution({targetRoot}), null, 2));
    return;
  }
  if (args.includes("--verify-plugin-only")) {
    const result = verifyPluginDistribution({targetRoot});
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (args.includes("--rollback-plugin-only")) {
    rollbackPluginDistribution({targetRoot});
    return;
  }
  throw new Error("use --dry-run, --install, --verify, --rollback, --migrate-plugin-only, --verify-plugin-only, --rollback-plugin-only, --install-global, --verify-global, or --rollback-global");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    log("command_failed", {message: error.message});
    process.exitCode = 1;
  }
}
