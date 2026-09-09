import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {defaultHarnessRuntimeRoot, installHarnessRuntime, verifyHarnessRuntime} from "./harness-runtime.mjs";

const MANIFEST_NAME = ".leon-engineering.json";
const GLOBAL_MANIFEST_NAME = ".leon-engineering-global.json";
const GLOBAL_HOOKS_NAME = "hooks.json";
const RUNTIME_ROOT_PLACEHOLDER = "__LEON_ENGINEERING_RUNTIME_ROOT__";
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_POLICY_START = "<!-- leon-engineering:global-framework:start -->";
const GLOBAL_POLICY_END = "<!-- leon-engineering:global-framework:end -->";

export const SKILL_NAMES = [
  "agent-routing",
  "bugfix-evidence",
  "feature-loop",
  "iteration-delivery",
  "logging-observability",
  "project-adapter",
  "project-bootstrap",
  "project-constraints",
  "project-harness",
  "review-ship",
  "skill-health"
];

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

function textChecksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function manifestPath(targetRoot) {
  return path.join(targetRoot, MANIFEST_NAME);
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
  const file = path.join(sourceRoot, "adapters", "codex", "global-policy.md");
  if (!fs.existsSync(file)) throw new Error("missing canonical global policy");
  const content = fs.readFileSync(file, "utf8").trim();
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
  if (existingManifest?.hooks && !existingHooks.hadFile) {
    throw new Error("missing managed global hooks");
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
  log("rolled_back", {skillCount: Object.keys(manifest.skills).length});
}

function main(args) {
  const targetIndex = args.indexOf("--target");
  if (targetIndex >= 0 && !args[targetIndex + 1]) throw new Error("--target requires a directory");
  const codexHomeIndex = args.indexOf("--codex-home");
  if (codexHomeIndex >= 0 && !args[codexHomeIndex + 1]) {
    throw new Error("--codex-home requires a directory");
  }
  const targetRoot = targetIndex >= 0
    ? args[targetIndex + 1]
    : path.join(os.homedir(), ".codex", "skills");
  const codexHome = codexHomeIndex >= 0
    ? args[codexHomeIndex + 1]
    : path.join(os.homedir(), ".codex");
  const globalActions = ["--install-global", "--verify-global", "--rollback-global"]
    .filter(action => args.includes(action));
  if (globalActions.length > 1) throw new Error("use only one global framework action");
  if (globalActions.length === 1 && targetIndex >= 0) {
    throw new Error("--target cannot be used with a global framework action");
  }

  if (args.includes("--install-global")) {
    const {documents, manifest} = installGlobalFramework({codexHome});
    installHarnessRuntime({sourceRoot: SOURCE_ROOT});
    console.log(JSON.stringify({
      installed: true,
      documents,
      frameworkVersion: manifest.frameworkVersion
    }));
    return;
  }
  if (args.includes("--verify-global")) {
    const verification = verifyGlobalFramework({codexHome});
    const runtime = verifyHarnessRuntime({sourceRoot: SOURCE_ROOT});
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
    const result = verify({targetRoot});
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (args.includes("--rollback")) {
    rollback({targetRoot});
    return;
  }
  throw new Error("use --dry-run, --install, --verify, --rollback, --install-global, --verify-global, or --rollback-global");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    log("command_failed", {message: error.message});
    process.exitCode = 1;
  }
}
