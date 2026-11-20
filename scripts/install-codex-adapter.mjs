import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {defaultHarnessRuntimeRoot, verifyHarnessRuntime} from "./harness-runtime.mjs";
import {REASONING_METHOD_GROUPS, REASONING_SKILL_NAMES} from "./reasoning-skills.mjs";

const MANIFEST_NAME = ".leon-engineering.json";
const DISTRIBUTION_MANIFEST_NAME = ".leon-engineering-distribution.json";
const GLOBAL_MANIFEST_NAME = ".leon-engineering-global.json";
const GLOBAL_HOOKS_NAME = "hooks.json";
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_POLICY_START = "<!-- leon-engineering:global-framework:start -->";
const GLOBAL_POLICY_END = "<!-- leon-engineering:global-framework:end -->";

export const CORE_SKILL_NAMES = Object.freeze([
  "agent-routing",
  "engineering-delivery",
  "engineering-work",
  "project-constraints",
  "project-harness",
  "project-onboarding"
]);

const RETIRED_SKILL_NAMES = Object.freeze([
  "bugfix-evidence", "feature-loop", "iteration-delivery",
  "project-adapter", "project-bootstrap", "review-ship",
  ...Object.values(REASONING_METHOD_GROUPS).flat()
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
    if ((!SKILL_NAMES.includes(name) && !RETIRED_SKILL_NAMES.includes(name)) || !/^[0-9a-f]{64}$/.test(checksum)) {
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
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return {content: "", hadFile: false};
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("global hooks.json is not a file");
  return {content: fs.readFileSync(file, "utf8"), hadFile: true};
}

function isLegacyLeonCommand(command, phase) {
  if (/[\r\n;&|<>`$()*?\[\]{}]/.test(command)) return false;
  const match = command.match(
    /^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[ \t]+--phase[ \t]+(pre|post)[ \t]+--host[ \t]+codex[ \t]*$/
  );
  if (!match || match[7] !== phase) return false;
  const executable = match[1] ?? match[2] ?? match[3];
  const script = match[4] ?? match[5] ?? match[6];
  const knownNodeCommands = new Set([
    "node", process.execPath, "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"
  ]);
  return knownNodeCommands.has(executable)
    && (path.isAbsolute(script) || path.win32.isAbsolute(script))
    && /\/leon-engineering\/runtime\/harness-hook\.mjs$/.test(script.replaceAll("\\", "/"));
}

function isLegacyLeonHooks(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || !parsed.hooks || typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks)
  ) return false;
  const events = Object.entries(parsed.hooks);
  return events.length > 0 && events.every(([event, entries]) => (
    (event === "PreToolUse" || event === "PostToolUse")
    && Array.isArray(entries) && entries.length > 0
    && entries.every(entry => (
      Array.isArray(entry?.hooks) && entry.hooks.length > 0
      && entry.hooks.every(hook => (
        hook?.type === "command" && typeof hook.command === "string"
        && isLegacyLeonCommand(hook.command, event === "PreToolUse" ? "pre" : "post")
      ))
    ))
  ));
}

function preflightGlobalFramework(sourceRoot, codexHome, existingManifest) {
  const policy = canonicalGlobalPolicy(sourceRoot);
  const documents = canonicalGlobalDocuments(sourceRoot);
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
  ) {
    throw new Error("drifted global hooks");
  }
  if (
    existingHooks.hadFile
    && (!existingManifest?.hooks || !isLegacyLeonHooks(existingHooks.content))
  ) {
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

  return {policy, documents, agents, existingHooks, range};
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
    documents
  };

  let removedLegacyHooks;
  try {
    if (prepared.existingHooks.hadFile) {
      const backupRoot = path.join(codexHome, ".leon-engineering-backups", crypto.randomUUID());
      fs.mkdirSync(backupRoot, {recursive: true, mode: 0o700});
      const backupPath = path.join(backupRoot, GLOBAL_HOOKS_NAME);
      fs.writeFileSync(backupPath, prepared.existingHooks.content, {flag: "wx", mode: 0o600});
      if (
        textChecksum(fs.readFileSync(backupPath, "utf8")) !== existingManifest.hooks.checksum
        || textChecksum(readExistingHooks(codexHome).content) !== existingManifest.hooks.checksum
      ) {
        throw new Error("global hooks changed during retirement");
      }
      fs.rmSync(globalHooksPath(codexHome));
      removedLegacyHooks = {backupPath, checksum: existingManifest.hooks.checksum};
      log("legacy_hooks_removed", {backupCreated: true});
    }
    const docsRoot = globalDocsPath(codexHome);
    fs.mkdirSync(docsRoot, {recursive: true});
    for (const [name, content] of Object.entries(prepared.documents)) {
      writeAtomically(path.join(docsRoot, name), content);
    }
    writeAtomically(globalAgentsPath(codexHome), installedPolicy.content);
    writeAtomically(globalManifestPath(codexHome), `${JSON.stringify(manifest, null, 2)}\n`);
    log("global_installed", {documentCount: GLOBAL_DOCUMENT_NAMES.length});
    const activation = existingManifest?.hooks ? {
      status: "restart_required",
      scope: "codex_host_process",
      note: "Legacy hook registration is retired. Restart the Codex host to clear any hooks cached by an existing process."
    } : {
      status: "new_session_required",
      scope: "codex_instructions",
      note: "No automatic hooks or Harness runtime are installed. Start a new session to load changed instructions."
    };
    return {documents: GLOBAL_DOCUMENT_NAMES, manifest, activation, ...(removedLegacyHooks ? {removedLegacyHooks} : {})};
  } catch (error) {
    if (removedLegacyHooks) {
      try {
        const content = fs.readFileSync(removedLegacyHooks.backupPath, "utf8");
        if (textChecksum(content) !== removedLegacyHooks.checksum) {
          throw new Error("legacy hooks backup changed during recovery");
        }
        fs.writeFileSync(globalHooksPath(codexHome), content, {flag: "wx", mode: 0o600});
        log("legacy_hooks_restored", {backupCreated: true});
      } catch (recoveryError) {
        error.removedLegacyHooks = removedLegacyHooks;
        error.message += `; legacy hooks backup: ${removedLegacyHooks.backupPath}`;
        log("legacy_hooks_restore_failed", {message: recoveryError.message, backupPath: removedLegacyHooks.backupPath});
      }
    }
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
    if (readExistingHooks(codexHome).hadFile) drift.push("hooks");
  } catch {
    drift.push("hooks");
  }
  try {
    const version = frameworkVersion(sourceRoot);
    if (typeof version !== "string" || !/^[A-Za-z0-9.+-]+$/.test(version)) {
      throw new Error("invalid framework version");
    }
    const cachedHooks = path.join(
      codexHome, "plugins", "cache", "leon-local", "leon-engineering", version, "hooks", GLOBAL_HOOKS_NAME
    );
    try {
      fs.lstatSync(cachedHooks);
      drift.push("hooks:plugin-registration");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } catch {
    drift.push("hooks:plugin-registration");
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
  const retired = Object.keys(existing?.skills ?? {}).filter(name => RETIRED_SKILL_NAMES.includes(name));
  for (const name of retired) {
    const installed = path.join(targetRoot, name);
    if (!fs.existsSync(installed) || fs.lstatSync(installed).isSymbolicLink()
      || skillChecksum(listSkillFiles(installed, name, false)) !== existing.skills[name]) {
      throw new Error(`refusing to retire drifted skill: ${name}`);
    }
  }
  const retiredPaths = [];
  const newDirectories = new Set(SKILL_NAMES.filter(name => !fs.existsSync(path.join(targetRoot, name))));
  const created = [];
  let preserveStaging = false;

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
      if (newDirectories.has(name)) {
        const destination = path.join(targetRoot, name);
        if (fs.existsSync(destination)) throw new Error(`skill directory created during install: ${name}`);
        fs.renameSync(path.join(staging, name), destination);
        created.push({name, destination, checksum: skills[name]});
        continue;
      }
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
    for (const name of retired) {
      const original = path.join(targetRoot, name);
      const previous = path.join(staging, "retired", name);
      fs.mkdirSync(path.dirname(previous), {recursive: true});
      fs.renameSync(original, previous);
      retiredPaths.push({original, previous});
    }
    writeAtomically(manifestPath(targetRoot), `${JSON.stringify(manifest, null, 2)}\n`);
    if (logResult) log("installed", {skillCount: SKILL_NAMES.length});
    return {skills: SKILL_NAMES, manifest};
  } catch (error) {
    const recoveryFailures = [];
    for (const {original, previous} of retiredPaths.reverse()) {
      try {
        if (fs.existsSync(original)) throw new Error("retired path recreated during install");
        fs.renameSync(previous, original);
      } catch {
        preserveStaging = true;
        recoveryFailures.push(original);
      }
    }
    for (const {name, destination, checksum} of created) {
      try {
        if (fs.lstatSync(destination).isSymbolicLink()
          || skillChecksum(listSkillFiles(destination, name, false)) !== checksum) {
          throw new Error("new skill changed during installation");
        }
        fs.rmSync(destination, {recursive: true});
      } catch {
        recoveryFailures.push(destination);
      }
    }
    if (recoveryFailures.length) {
      throw new Error(`install rollback needs review: ${recoveryFailures.join(", ")}; staging: ${staging}`, {cause: error});
    }
    if (logResult) log("install_failed", {message: error.message});
    throw error;
  } finally {
    if (!preserveStaging) fs.rmSync(staging, {recursive: true, force: true});
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
    if ((!SKILL_NAMES.includes(name) && !RETIRED_SKILL_NAMES.includes(name)) || !/^[0-9a-f]{64}$/.test(checksum)) {
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

function verifyOptionalRuntime({sourceRoot, runtimeRoot}) {
  try {
    fs.lstatSync(runtimeRoot);
  } catch (error) {
    if (error.code !== "ENOENT") {
      log("runtime_verification_failed", {code: error.code ?? "UNKNOWN"});
      return {valid: false, drift: ["runtime verification"]};
    }
    return {valid: true, drift: [], installed: false, status: "NOT_INSTALLED"};
  }
  return boundedVerification(
    () => verifyHarnessRuntime({sourceRoot, runtimeRoot}),
    "runtime verification"
  );
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
  const runtime = verifyOptionalRuntime({sourceRoot, runtimeRoot});
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
    const {documents, manifest, activation, removedLegacyHooks} = installGlobalFramework({codexHome});
    console.log(JSON.stringify({
      installed: true,
      documents,
      frameworkVersion: manifest.frameworkVersion,
      ...(removedLegacyHooks ? {removedLegacyHooks} : {}),
      activation
    }));
    return;
  }
  if (args.includes("--verify-global")) {
    const verification = verifyGlobalFramework({codexHome});
    const runtime = verifyOptionalRuntime({sourceRoot: SOURCE_ROOT, runtimeRoot});
    const result = {
      valid: verification.valid && runtime.valid,
      drift: [...verification.drift, ...runtime.drift.map(item => `runtime:${item}`)],
      runtime
    };
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
