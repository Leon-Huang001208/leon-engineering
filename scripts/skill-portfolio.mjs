import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function assertAbsolute(value, field) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${field} must be absolute`);
  return path.resolve(value);
}

function ensurePrivateDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid private directory");
    fs.chmodSync(directory, 0o700);
    return;
  }
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
}

function writePrivateJson(destination, value, {replace = false} = {}) {
  ensurePrivateDirectory(path.dirname(destination));
  if (!replace && fs.existsSync(destination)) throw new Error("receipt already exists");
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function auditSkillTree(directory) {
  const root = assertAbsolute(directory, "skill directory");
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("invalid Skill directory");
  const files = [];

  function visit(relativeDirectory) {
    const current = path.join(root, relativeDirectory);
    const entries = fs.readdirSync(current, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const portable = relative.split(path.sep).join("/");
      const absolute = path.join(root, relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Skill tree contains a symbolic link: ${portable}`);
      if (stat.isDirectory()) {
        visit(relative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Skill tree contains an unsupported entry: ${portable}`);
      if ((stat.mode & 0o444) === 0) throw new Error(`Skill tree contains an unreadable file: ${portable}`);
      let content;
      try {
        content = fs.readFileSync(absolute);
      } catch {
        throw new Error(`Skill tree contains an unreadable file: ${portable}`);
      }
      files.push({path: portable, bytes: content.length, sha256: sha256(content)});
    }
  }

  visit("");
  if (!files.some(file => file.path === "SKILL.md")) throw new Error("Skill tree is missing SKILL.md");
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return {
    treeHash: hash.digest("hex"),
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    files
  };
}

function auditCanonicalTree(directory) {
  const canonical = assertAbsolute(directory, "canonical Skill");
  const stat = fs.lstatSync(canonical);
  return auditSkillTree(stat.isSymbolicLink() ? fs.realpathSync(canonical) : canonical);
}

const SANITIZED_EXCLUDED_SEGMENTS = new Set([
  ".env", ".pytest_cache", "__pycache__", "chroma_db", "data", "logs", "log", "output", "outputs", "test_output"
]);
const SANITIZED_EXCLUDED_FILES = new Set(["config.yaml", "config.yml", "update-state.json"]);
const SANITIZED_EXCLUDED_EXTENSIONS = new Set([".bin", ".lock", ".log", ".pyc", ".sqlite3", ".xlsx"]);
const LITERAL_SECRET = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|private[_-]?key)\b\s*[:=]\s*["'](?!example|placeholder|your_|<)[^"']{8,}["']/i;

function shouldExcludeSanitized(relative) {
  const portable = relative.split(path.sep).join("/");
  const segments = portable.split("/");
  const basename = segments.at(-1);
  return segments.some(segment => SANITIZED_EXCLUDED_SEGMENTS.has(segment))
    || SANITIZED_EXCLUDED_FILES.has(basename)
    || SANITIZED_EXCLUDED_EXTENSIONS.has(path.extname(basename));
}

export function copySanitizedSkill({source, destination}) {
  const sourceRoot = assertAbsolute(source, "source Skill");
  const destinationRoot = assertAbsolute(destination, "destination Skill");
  if (fs.existsSync(destinationRoot)) throw new Error("destination Skill already exists");
  const rootStat = fs.lstatSync(sourceRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("invalid source Skill");
  const included = [];
  const excluded = [];

  function visit(relativeDirectory) {
    const directory = path.join(sourceRoot, relativeDirectory);
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = path.join(relativeDirectory, entry.name);
      const portable = relative.split(path.sep).join("/");
      const absolute = path.join(sourceRoot, relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`source Skill contains a symbolic link: ${portable}`);
      if (entry.isDirectory()) {
        if (shouldExcludeSanitized(relative)) {
          for (const nested of enumerateRelativeFiles(absolute, portable)) excluded.push(nested);
        } else visit(relative);
      } else if (entry.isFile()) {
        if (shouldExcludeSanitized(relative)) {
          excluded.push(portable);
          continue;
        }
        const content = fs.readFileSync(absolute);
        if (content.length <= 2_000_000 && LITERAL_SECRET.test(content.toString("utf8"))) {
          throw new Error(`included source contains a literal secret: ${portable}`);
        }
        included.push({path: portable, source: absolute, mode: stat.mode & 0o777});
      } else throw new Error(`source Skill contains an unsupported entry: ${portable}`);
    }
  }

  function enumerateRelativeFiles(directory, prefix) {
    const files = [];
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const portable = `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`source Skill contains a symbolic link: ${portable}`);
      if (entry.isDirectory()) files.push(...enumerateRelativeFiles(absolute, portable));
      else if (entry.isFile()) files.push(portable);
      else throw new Error(`source Skill contains an unsupported entry: ${portable}`);
    }
    return files;
  }

  visit("");
  if (!included.some(file => file.path === "SKILL.md")) throw new Error("sanitized Skill is missing SKILL.md");
  try {
    for (const file of included) {
      const target = path.join(destinationRoot, file.path);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, file.mode);
    }
    const audit = auditSkillTree(destinationRoot);
    return {
      treeHash: audit.treeHash,
      fileCount: audit.fileCount,
      bytes: audit.bytes,
      included: included.map(file => file.path).sort(),
      excluded: excluded.sort()
    };
  } catch (error) {
    fs.rmSync(destinationRoot, {recursive: true, force: true});
    throw error;
  }
}

function readJson(file, description) {
  const resolved = assertAbsolute(file, description);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`invalid ${description}`);
  try {
    return {file: resolved, value: JSON.parse(fs.readFileSync(resolved, "utf8"))};
  } catch {
    throw new Error(`invalid ${description}`);
  }
}

function readManifest(manifestPath) {
  const {file, value} = readJson(manifestPath, "portfolio manifest");
  if (value?.schemaVersion !== 1 || !Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error("invalid portfolio manifest");
  }
  const backupRoot = assertAbsolute(value.backupRoot, "backup root");
  const receiptPath = assertAbsolute(value.receiptPath, "receipt path");
  const ids = new Set();
  const actions = value.actions.map(action => {
    const kind = action?.kind ?? "exact-duplicate";
    if (!action || typeof action !== "object" || Array.isArray(action)
      || typeof action.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(action.id)
      || ids.has(action.id) || !new Set(["exact-duplicate", "quarantine"]).has(kind)
      || !/^[0-9a-f]{64}$/.test(action.expectedTreeHash ?? "")) {
      throw new Error("invalid portfolio action");
    }
    ids.add(action.id);
    return {
      id: action.id,
      kind,
      source: assertAbsolute(action.source, "action source"),
      canonical: kind === "quarantine" ? null : assertAbsolute(action.canonical, "canonical Skill"),
      backup: path.join(backupRoot, action.id),
      expectedTreeHash: action.expectedTreeHash
    };
  });
  return {file, backupRoot, receiptPath, actions};
}

export function previewSkillPortfolio({manifestPath}) {
  const manifest = readManifest(manifestPath);
  const conflicts = [];
  const actions = [];
  for (const action of manifest.actions) {
    let sourceAudit = null;
    let canonicalAudit = null;
    try {
      sourceAudit = auditSkillTree(action.source);
    } catch {
      conflicts.push(`${action.id}:invalid-source`);
    }
    if (action.canonical) {
      try {
        canonicalAudit = auditCanonicalTree(action.canonical);
      } catch {
        conflicts.push(`${action.id}:invalid-canonical`);
      }
    }
    if (sourceAudit && sourceAudit.treeHash !== action.expectedTreeHash) conflicts.push(`${action.id}:source-hash`);
    if (canonicalAudit && canonicalAudit.treeHash !== action.expectedTreeHash) conflicts.push(`${action.id}:canonical-hash`);
    if (fs.existsSync(action.backup)) conflicts.push(`${action.id}:backup-exists`);
    actions.push({
      id: action.id,
      kind: action.kind,
      treeHash: action.expectedTreeHash,
      fileCount: sourceAudit?.fileCount ?? 0,
      bytes: sourceAudit?.bytes ?? 0
    });
  }
  if (fs.existsSync(manifest.receiptPath)) conflicts.push("receipt-exists");
  return {
    schemaVersion: 1,
    valid: conflicts.length === 0,
    actions,
    conflicts,
    summary: {
      actionCount: actions.length,
      fileCount: actions.reduce((total, action) => total + action.fileCount, 0),
      bytes: actions.reduce((total, action) => total + action.bytes, 0)
    }
  };
}

export function applySkillPortfolio({manifestPath}, dependencies = {}) {
  const manifest = readManifest(manifestPath);
  const preview = previewSkillPortfolio({manifestPath});
  if (!preview.valid) throw new Error(`portfolio preflight failed: ${preview.conflicts.join(", ")}`);
  ensurePrivateDirectory(manifest.backupRoot);
  const moved = [];
  try {
    for (const action of manifest.actions) {
      fs.renameSync(action.source, action.backup);
      moved.push(action);
      dependencies.afterMove?.(action);
      const backupAudit = auditSkillTree(action.backup);
      if (backupAudit.treeHash !== action.expectedTreeHash) throw new Error(`backup verification failed: ${action.id}`);
    }
    const receipt = {
      schemaVersion: 1,
      status: "applied",
      manifestSha256: sha256(fs.readFileSync(manifest.file)),
      appliedAt: new Date().toISOString(),
      actions: moved.map(action => ({
        id: action.id,
        kind: action.kind,
        source: action.source,
        canonical: action.canonical,
        backup: action.backup,
        treeHash: action.expectedTreeHash
      }))
    };
    writePrivateJson(manifest.receiptPath, receipt);
    return receipt;
  } catch (error) {
    for (const action of moved.reverse()) {
      if (!fs.existsSync(action.source) && fs.existsSync(action.backup)) fs.renameSync(action.backup, action.source);
    }
    throw error;
  }
}

function readReceipt(receiptPath) {
  const {file, value} = readJson(receiptPath, "portfolio receipt");
  if (value?.schemaVersion !== 1 || value.status !== "applied" || !Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error("invalid portfolio receipt");
  }
  const actions = value.actions.map(action => {
    if (!action || typeof action !== "object" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(action.id ?? "")
      || !new Set(["exact-duplicate", "quarantine"]).has(action.kind ?? "exact-duplicate")
      || !/^[0-9a-f]{64}$/.test(action.treeHash ?? "")) throw new Error("invalid portfolio receipt");
    return {
      id: action.id,
      kind: action.kind ?? "exact-duplicate",
      source: assertAbsolute(action.source, "receipt source"),
      canonical: action.canonical === null ? null : assertAbsolute(action.canonical, "receipt canonical"),
      backup: assertAbsolute(action.backup, "receipt backup"),
      treeHash: action.treeHash
    };
  });
  return {file, value, actions};
}

export function rollbackSkillPortfolio({receiptPath}) {
  const receipt = readReceipt(receiptPath);
  const conflicts = [];
  for (const action of receipt.actions) {
    if (fs.existsSync(action.source)) conflicts.push(`${action.id}:source-exists`);
    try {
      if (auditSkillTree(action.backup).treeHash !== action.treeHash) conflicts.push(`${action.id}:backup-hash`);
      if (action.canonical && auditCanonicalTree(action.canonical).treeHash !== action.treeHash) conflicts.push(`${action.id}:canonical-hash`);
    } catch {
      conflicts.push(`${action.id}:invalid-tree`);
    }
  }
  if (conflicts.length > 0) throw new Error(`rollback preflight failed: ${[...new Set(conflicts)].join(", ")}`);
  for (const action of receipt.actions) fs.renameSync(action.backup, action.source);
  const rolledBack = {...receipt.value, status: "rolled_back", rolledBackAt: new Date().toISOString()};
  writePrivateJson(receipt.file, rolledBack, {replace: true});
  return rolledBack;
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--manifest", "--receipt"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--preview") options.preview = true;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--rollback") options.rollback = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  const modes = [options.preview, options.apply, options.rollback].filter(Boolean).length;
  if (modes > 1) throw new Error("select one portfolio mode");
  if (options.rollback) {
    if (!options.receipt || options.manifest) throw new Error("rollback requires --receipt only");
  } else if (!options.manifest || options.receipt) {
    throw new Error("preview/apply requires --manifest only");
  }
  return options;
}

function usage() {
  return [
    "Usage: skill-portfolio.mjs [--preview] --manifest <absolute-json>",
    "       skill-portfolio.mjs --apply --manifest <absolute-json>",
    "       skill-portfolio.mjs --rollback --receipt <absolute-json>",
    "",
    "Preview is the default. Apply and rollback require exact tree hashes and fail closed."
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = options.rollback
    ? rollbackSkillPortfolio({receiptPath: options.receipt})
    : options.apply
      ? applySkillPortfolio({manifestPath: options.manifest})
      : previewSkillPortfolio({manifestPath: options.manifest});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.valid === false) process.exitCode = 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`skill portfolio failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
