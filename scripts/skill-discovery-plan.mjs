import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {auditSkillTree} from "./skill-portfolio.mjs";

const PLUGINS = ["leon-engineering-core", "leon-engineering-workflows"];

class DiscoveryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function absolute(value, code) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new DiscoveryError(code);
  }
  return path.resolve(value);
}

function directory(value, code, {allowMissing = false} = {}) {
  try {
    let current = path.parse(value).root;
    const segments = value.slice(current.length).split(path.sep).filter(Boolean);
    for (let index = 0; index <= segments.length; index += 1) {
      const stat = lstatOptional(current);
      if (!stat) {
        if (allowMissing) return path.join(current, ...segments.slice(index));
        throw new DiscoveryError(code);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory() || !(stat.mode & 0o444) || !(stat.mode & 0o111)) {
        throw new DiscoveryError(code);
      }
      current = fs.realpathSync(current);
      if (index < segments.length) current = path.join(current, segments[index]);
    }
    return current;
  } catch {
    throw new DiscoveryError(code);
  }
}

function contains(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function overlaps(left, right) {
  return contains(left, right) || contains(right, left);
}

function validateRoots(options) {
  for (const [index, root] of options.skillsRoots.entries()) {
    if (overlaps(root, options.sourceRoot) || options.skillsRoots.slice(0, index).some(other => overlaps(root, other))) {
      throw new DiscoveryError("invalid_skills_root");
    }
  }
  const protectedRoots = [options.sourceRoot, ...options.skillsRoots];
  options.backupRoot = directory(options.backupRoot, "invalid_backup_root", {allowMissing: true});
  if (protectedRoots.some(root => overlaps(root, options.backupRoot))) throw new DiscoveryError("invalid_backup_root");
  options.receiptPath = path.join(
    directory(path.dirname(options.receiptPath), "invalid_receipt_path", {allowMissing: true}),
    path.basename(options.receiptPath)
  );
  try {
    if (lstatOptional(options.receiptPath)
      || protectedRoots.some(root => contains(root, options.receiptPath))
      || contains(options.receiptPath, options.backupRoot)) throw new DiscoveryError("invalid_receipt_path");
  } catch {
    throw new DiscoveryError("invalid_receipt_path");
  }
  return options;
}

function parseArgs(args) {
  const values = new Map();
  let includeDivergent = false;
  const allowed = new Set(["--source-root", "--skills-root", "--backup-root", "--receipt"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--include-divergent" && !includeDivergent) {
      includeDivergent = true;
      continue;
    }
    if (!allowed.has(flag) || (flag !== "--skills-root" && values.has(flag))) throw new DiscoveryError("invalid_args");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new DiscoveryError("invalid_args");
    values.set(flag, [...(values.get(flag) ?? []), value]);
  }
  if ([...allowed].some(flag => !values.has(flag))) throw new DiscoveryError("invalid_args");
  return validateRoots({
    sourceRoot: directory(absolute(values.get("--source-root")[0], "invalid_source_root"), "invalid_source_root"),
    skillsRoots: [...new Set(values.get("--skills-root").map(value => directory(absolute(value, "invalid_skills_root"), "invalid_skills_root")))].sort(),
    backupRoot: absolute(values.get("--backup-root")[0], "invalid_backup_root"),
    receiptPath: absolute(values.get("--receipt")[0], "invalid_receipt_path"),
    includeDivergent
  });
}

function lstatOptional(value) {
  try {
    return fs.lstatSync(value);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function canonicalSkills(sourceRoot) {
  const skills = new Map();
  try {
    for (const plugin of PLUGINS) {
      const root = directory(path.join(sourceRoot, "plugins", plugin, "skills"), "invalid_source_root");
      for (const name of fs.readdirSync(root).sort()) {
        const canonical = path.join(root, name);
        const stat = fs.lstatSync(canonical);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        if (!fs.readdirSync(canonical).includes("SKILL.md")) continue;
        const skill = lstatOptional(path.join(canonical, "SKILL.md"));
        if (!skill?.isFile() || skill.isSymbolicLink()) continue;
        if (skills.has(name)) throw new DiscoveryError("invalid_source_root");
        skills.set(name, canonical);
      }
    }
  } catch {
    throw new DiscoveryError("invalid_source_root");
  }
  return [...skills].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function actionId(source, name) {
  const prefix = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 15) || "skill";
  return `${prefix}-${crypto.createHash("sha256").update(source).digest("hex")}`;
}

function discover(options) {
  const canonical = canonicalSkills(options.sourceRoot);
  const actions = [];
  const skipped = [];
  for (const root of options.skillsRoots) {
    for (const [name, canonicalPath] of canonical) {
      const source = path.join(root, name);
      let reason;
      try {
        const stat = lstatOptional(source);
        if (!stat) reason = "missing";
        else if (stat.isSymbolicLink()) reason = "ownership_unknown";
        else if (!stat.isDirectory()) reason = "unsupported_tree";
        else {
          const sourceAudit = auditSkillTree(source);
          const canonicalAudit = auditSkillTree(canonicalPath);
          const exact = sourceAudit.treeHash === canonicalAudit.treeHash;
          if (!exact && !options.includeDivergent) reason = "divergent";
          else {
            const action = {
              id: actionId(source, name),
              kind: exact ? "exact-duplicate" : "quarantine",
              source,
              ...(exact ? {canonical: canonicalPath} : {}),
              expectedTreeHash: sourceAudit.treeHash
            };
            actions.push(action);
          }
        }
      } catch {
        reason = "unsupported_tree";
      }
      if (reason) skipped.push({name, source, reason});
    }
  }
  try {
    if (actions.some(action => lstatOptional(path.join(options.backupRoot, action.id)))) {
      throw new DiscoveryError("invalid_backup_root");
    }
  } catch {
    throw new DiscoveryError("invalid_backup_root");
  }
  return {
    schemaVersion: 1,
    backupRoot: options.backupRoot,
    receiptPath: options.receiptPath,
    actions,
    summary: {
      skillsRootCount: options.skillsRoots.length,
      canonicalSkillCount: canonical.length,
      actionCount: actions.length,
      exactDuplicateCount: actions.filter(action => action.kind === "exact-duplicate").length,
      quarantineCount: actions.filter(action => action.kind === "quarantine").length,
      skippedCount: skipped.length
    },
    skipped
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
      process.stdout.write("Usage: skill-discovery-plan.mjs --source-root <absolute-repo> --skills-root <absolute-directory> [--skills-root <absolute-directory>] --backup-root <absolute-directory> --receipt <absolute-json> [--include-divergent]\nRead-only: print a portfolio manifest; apply and rollback use skill-portfolio.mjs.\n");
    } else {
      process.stdout.write(`${JSON.stringify(discover(parseArgs(args)), null, 2)}\n`);
    }
  } catch (error) {
    const code = error instanceof DiscoveryError ? error.code : "discovery_failed";
    process.stderr.write(`${JSON.stringify({schemaVersion: 1, error: {code}})}\n`);
    process.exitCode = 1;
  }
}
