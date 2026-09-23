import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const PROFILE_KEYS = new Set(["schemaVersion", "model_reasoning_effort", "plugins"]);
const REASONING = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function absoluteFile(value, field, {mustExist = true} = {}) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${field} must be absolute`);
  const resolved = path.resolve(value);
  if (mustExist) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`invalid ${field}`);
  }
  return resolved;
}

function readProfile(profilePath) {
  const file = absoluteFile(profilePath, "profile path");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("invalid profile JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !PROFILE_KEYS.has(key))
    || value.schemaVersion !== 1) throw new Error("invalid profile keys");
  if (value.model_reasoning_effort !== undefined && !REASONING.has(value.model_reasoning_effort)) {
    throw new Error("invalid reasoning effort");
  }
  if (value.plugins !== undefined && (!value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins)
    || Object.values(value.plugins).some(enabled => typeof enabled !== "boolean"))) {
    throw new Error("invalid plugin profile");
  }
  if (value.model_reasoning_effort === undefined && Object.keys(value.plugins ?? {}).length === 0) {
    throw new Error("empty profile");
  }
  return {file, value};
}

function parseConfig(content) {
  const lines = content.match(/.*(?:\n|$)/g).filter(line => line.length > 0);
  let section = null;
  let reasoning = null;
  const plugins = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const header = line.match(/^\s*\[plugins\."([^"]+)"\]\s*(?:#[^\r\n]*)?(?:\r?\n)?$/);
    if (header) {
      section = {kind: "plugin", name: header[1]};
      continue;
    }
    if (/^\s*\[/.test(line)) section = {kind: "other"};
    if (!section) {
      const match = line.match(/^(\s*model_reasoning_effort\s*=\s*)"([^"]+)"([^\r\n]*)(\r?\n)?$/);
      if (match) reasoning = {index, prefix: match[1], value: match[2], suffix: match[3], newline: match[4] ?? ""};
    } else if (section.kind === "plugin") {
      const match = line.match(/^(\s*enabled\s*=\s*)(true|false)([^\r\n]*)(\r?\n)?$/);
      if (match) {
        if (plugins.has(section.name)) throw new Error("duplicate configured plugin");
        plugins.set(section.name, {index, prefix: match[1], value: match[2] === "true", suffix: match[3], newline: match[4] ?? ""});
      }
    }
  }
  if (!reasoning) throw new Error("missing model_reasoning_effort");
  return {lines, reasoning, plugins};
}

function renderProfile(configContent, profile) {
  const parsed = parseConfig(configContent);
  const changes = [];
  const replacements = new Map();
  if (profile.model_reasoning_effort !== undefined && parsed.reasoning.value !== profile.model_reasoning_effort) {
    changes.push({field: "model_reasoning_effort", before: parsed.reasoning.value, after: profile.model_reasoning_effort});
    replacements.set(parsed.reasoning.index, `${parsed.reasoning.prefix}"${profile.model_reasoning_effort}"${parsed.reasoning.suffix}${parsed.reasoning.newline}`);
  }
  for (const [name, enabled] of Object.entries(profile.plugins ?? {})) {
    const configured = parsed.plugins.get(name);
    if (!configured) throw new Error(`unknown configured plugin: ${name}`);
    if (configured.value === enabled) continue;
    changes.push({field: `plugins."${name}".enabled`, before: configured.value, after: enabled});
    replacements.set(configured.index, `${configured.prefix}${enabled ? "true" : "false"}${configured.suffix}${configured.newline}`);
  }
  const rendered = parsed.lines.map((line, index) => replacements.get(index) ?? line).join("");
  return {content: rendered, changes};
}

export function previewProfile({configPath, profilePath}) {
  const configFile = absoluteFile(configPath, "config path");
  const profile = readProfile(profilePath);
  const current = fs.readFileSync(configFile, "utf8");
  const rendered = renderProfile(current, profile.value);
  return {
    schemaVersion: 1,
    changes: rendered.changes,
    currentSha256: sha256(current),
    nextSha256: sha256(rendered.content),
    profileSha256: sha256(fs.readFileSync(profile.file))
  };
}

function ensurePrivateParent(file) {
  const parent = path.dirname(file);
  if (fs.existsSync(parent)) {
    const stat = fs.lstatSync(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid private directory");
    fs.chmodSync(parent, 0o700);
  } else fs.mkdirSync(parent, {recursive: true, mode: 0o700});
}

function atomicWrite(file, content, mode = 0o600) {
  ensurePrivateParent(file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {flag: "wx", mode});
    fs.renameSync(temporary, file);
    fs.chmodSync(file, mode);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function applyProfile({configPath, profilePath, backupPath, receiptPath}) {
  const configFile = absoluteFile(configPath, "config path");
  const profile = readProfile(profilePath);
  const backupFile = absoluteFile(backupPath, "backup path", {mustExist: false});
  const receiptFile = absoluteFile(receiptPath, "receipt path", {mustExist: false});
  if (fs.existsSync(backupFile)) throw new Error("backup already exists");
  if (fs.existsSync(receiptFile)) throw new Error("receipt already exists");
  const current = fs.readFileSync(configFile, "utf8");
  const rendered = renderProfile(current, profile.value);
  if (rendered.changes.length === 0) throw new Error("profile produces no changes");
  ensurePrivateParent(backupFile);
  fs.writeFileSync(backupFile, current, {flag: "wx", mode: 0o600});
  atomicWrite(configFile, rendered.content);
  if (fs.readFileSync(configFile, "utf8") !== rendered.content) throw new Error("profile readback failed");
  const receipt = {
    schemaVersion: 1,
    status: "applied",
    originalSha256: sha256(current),
    appliedSha256: sha256(rendered.content),
    profileSha256: sha256(fs.readFileSync(profile.file)),
    changes: rendered.changes,
    appliedAt: new Date().toISOString()
  };
  atomicWrite(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function readReceipt(receiptPath) {
  const file = absoluteFile(receiptPath, "receipt path");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("invalid profile receipt");
  }
  if (value?.schemaVersion !== 1 || value.status !== "applied"
    || !/^[0-9a-f]{64}$/.test(value.originalSha256 ?? "")
    || !/^[0-9a-f]{64}$/.test(value.appliedSha256 ?? "")) throw new Error("invalid profile receipt");
  return {file, value};
}

export function rollbackProfile({configPath, backupPath, receiptPath}) {
  const configFile = absoluteFile(configPath, "config path");
  const backupFile = absoluteFile(backupPath, "backup path");
  const receipt = readReceipt(receiptPath);
  const current = fs.readFileSync(configFile);
  const backup = fs.readFileSync(backupFile);
  if (sha256(current) !== receipt.value.appliedSha256) throw new Error("current config drifted after profile apply");
  if (sha256(backup) !== receipt.value.originalSha256) throw new Error("profile backup drifted");
  atomicWrite(configFile, backup);
  const rolledBack = {...receipt.value, status: "rolled_back", rolledBackAt: new Date().toISOString()};
  atomicWrite(receipt.file, `${JSON.stringify(rolledBack, null, 2)}\n`);
  return rolledBack;
}

export function validateExperimentManifest(value) {
  const keys = ["schemaVersion", "commit", "promptHash", "model", "reasoning", "calls", "tools", "tokens", "errors", "permissions", "gates", "qualityGrade"];
  const tokenKeys = ["input", "cachedInput", "nonCachedInput", "output", "reasoning", "weighted"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || value.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(value.commit)
    || !/^[0-9a-f]{64}$/.test(value.promptHash) || typeof value.model !== "string"
    || !REASONING.has(value.reasoning) || !Number.isInteger(value.calls) || value.calls < 0
    || !Number.isInteger(value.tools) || value.tools < 0 || !Number.isInteger(value.errors) || value.errors < 0
    || !value.tokens || typeof value.tokens !== "object" || Array.isArray(value.tokens)
    || Object.keys(value.tokens).length !== tokenKeys.length || tokenKeys.some(key => !Number.isFinite(value.tokens[key]) || value.tokens[key] < 0)
    || value.permissions !== "unchanged" || value.gates !== "passed" || value.qualityGrade !== "correct") {
    throw new Error("invalid experiment manifest");
  }
  return value;
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {};
  const valued = new Set(["--config", "--profile", "--backup", "--receipt"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valued.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--preview") options.preview = true;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--rollback") options.rollback = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.config) throw new Error("--config is required");
  const modes = [options.preview, options.apply, options.rollback].filter(Boolean).length;
  if (modes > 1) throw new Error("select one profile mode");
  if (options.rollback) {
    if (!options.backup || !options.receipt || options.profile) throw new Error("rollback requires --backup and --receipt");
  } else if (!options.profile || (options.apply && (!options.backup || !options.receipt))) {
    throw new Error("preview/apply requires --profile; apply also requires --backup and --receipt");
  }
  return options;
}

function usage() {
  return [
    "Usage: codex-profile.mjs [--preview] --config <toml> --profile <json>",
    "       codex-profile.mjs --apply --config <toml> --profile <json> --backup <file> --receipt <json>",
    "       codex-profile.mjs --rollback --config <toml> --backup <file> --receipt <json>"
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const common = {configPath: options.config, profilePath: options.profile, backupPath: options.backup, receiptPath: options.receipt};
  const result = options.rollback ? rollbackProfile(common) : options.apply ? applyProfile(common) : previewProfile(common);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Codex profile failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
