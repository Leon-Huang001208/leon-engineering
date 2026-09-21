import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const POLICY_PATH = path.posix.join(".agents", "verification-policy.json");
const TIERS = ["read-only", "local-only", "isolated", "full-delivery"];
const CHANGE_KINDS = new Set(["documentation", "internal", "behavior", "contract", "schema", "database", "dependency", "ci", "security", "desktop"]);
const KIND_MINIMUM = {
  documentation: "read-only",
  internal: "local-only",
  behavior: "isolated",
  contract: "full-delivery",
  schema: "full-delivery",
  database: "full-delivery",
  dependency: "full-delivery",
  ci: "full-delivery",
  security: "full-delivery",
  desktop: "full-delivery"
};

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function normalizeRelative(value, field) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) throw new Error(`invalid ${field}`);
  const normalized = path.normalize(value).split(path.sep).join("/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) throw new Error(`unsafe ${field}`);
  return normalized;
}

function safeFile(root, relative) {
  const destination = path.resolve(root, normalizeRelative(relative, "policy path"));
  if (!isWithin(root, destination) || !fs.existsSync(destination)) throw new Error("missing verification policy");
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("invalid verification policy");
  }
  if (!fs.statSync(destination).isFile()) throw new Error("invalid verification policy");
  return destination;
}

function stringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length === 0)) throw new Error(`invalid ${field}`);
  return value;
}

function loadPolicy(root) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(safeFile(root, POLICY_PATH), "utf8"));
  } catch (error) {
    if (/verification policy/.test(error.message)) throw error;
    throw new Error("invalid verification policy");
  }
  if (policy?.schemaVersion !== 1 || !policy.verifiers || typeof policy.verifiers !== "object" || !Array.isArray(policy.rules)) {
    throw new Error("invalid verification policy");
  }
  const verifiers = {};
  for (const [id, verifier] of Object.entries(policy.verifiers)) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || !verifier || typeof verifier !== "object" || Array.isArray(verifier)) {
      throw new Error("invalid verification policy verifier");
    }
    if (!new Set(["test", "lint"]).has(verifier.kind) || !Array.isArray(verifier.argv) || verifier.argv.length === 0
      || verifier.argv.some(item => typeof item !== "string" || item.length === 0)) throw new Error("invalid verification policy verifier");
    verifiers[id] = {
      id,
      kind: verifier.kind,
      argv: verifier.argv,
      cwd: verifier.cwd === undefined || verifier.cwd === "." ? "." : normalizeRelative(verifier.cwd, "verifier cwd"),
      appendChangedFiles: verifier.appendChangedFiles === true,
      extensions: stringList(verifier.extensions, "verifier extensions")
    };
  }
  const rules = policy.rules.map(rule => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || typeof rule.name !== "string" || !rule.name.trim()) {
      throw new Error("invalid verification policy rule");
    }
    const minimumTier = rule.minimumTier ?? "read-only";
    if (!TIERS.includes(minimumTier)) throw new Error("invalid verification policy tier");
    const tests = stringList(rule.tests, "rule tests");
    const lints = stringList(rule.lints, "rule lints");
    for (const id of [...tests, ...lints]) if (!verifiers[id]) throw new Error("unknown verification policy verifier");
    return {
      name: rule.name.trim(),
      prefixes: stringList(rule.prefixes, "rule prefixes").map(value => normalizeRelative(value, "rule prefix")),
      minimumTier,
      tests,
      lints,
      documentation: stringList(rule.documentation, "rule documentation"),
      ci: stringList(rule.ci, "rule ci"),
      gates: stringList(rule.gates, "rule gates")
    };
  });
  return {verifiers, rules};
}

function tierMax(...tiers) {
  return TIERS[Math.max(...tiers.map(tier => TIERS.indexOf(tier)))];
}

function matches(file, prefix) {
  return prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix;
}

function verifierClosure(ids, verifiers, changedFiles, reasons) {
  return [...new Set(ids)].sort().map(id => {
    const verifier = verifiers[id];
    const appended = verifier.appendChangedFiles
      ? changedFiles.filter(file => verifier.extensions.length === 0 || verifier.extensions.some(extension => file.endsWith(extension)))
      : [];
    return {id, kind: verifier.kind, argv: [...verifier.argv, ...appended], cwd: verifier.cwd, reason: [...new Set(reasons.get(id) ?? [])]};
  });
}

export function buildVerificationPlan({projectRoot, riskTier, changeKind, changedFiles}) {
  if (!TIERS.includes(riskTier)) throw new Error("invalid risk tier");
  if (!CHANGE_KINDS.has(changeKind)) throw new Error("invalid change kind");
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) throw new Error("at least one changed file is required");
  const root = fs.realpathSync(projectRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error("invalid project root");
  const files = [...new Set(changedFiles.map(file => normalizeRelative(file, "changed file")))].sort();
  const policy = loadPolicy(root);
  const matchedByFile = new Map(files.map(file => [file, policy.rules.filter(rule => rule.prefixes.some(prefix => matches(file, prefix)))]));
  const unmappedPaths = files.filter(file => matchedByFile.get(file).length === 0);
  const matched = [...new Set([...matchedByFile.values()].flat())];
  let effectiveRiskTier = tierMax(riskTier, KIND_MINIMUM[changeKind], ...matched.map(rule => rule.minimumTier));
  const escalationReason = [];
  if (TIERS.indexOf(KIND_MINIMUM[changeKind]) > TIERS.indexOf(riskTier)) escalationReason.push(`change-kind:${changeKind}`);
  for (const rule of matched) {
    if (TIERS.indexOf(rule.minimumTier) > TIERS.indexOf(riskTier)) escalationReason.push(`rule:${rule.name}`);
  }
  if (unmappedPaths.length > 0) {
    effectiveRiskTier = "full-delivery";
    escalationReason.push("unmapped-paths");
  }
  const testIds = matched.flatMap(rule => rule.tests);
  const lintIds = matched.flatMap(rule => rule.lints);
  const reasons = new Map();
  for (const rule of matched) {
    for (const id of [...rule.tests, ...rule.lints]) {
      const values = reasons.get(id) ?? [];
      values.push(rule.name);
      reasons.set(id, values);
    }
  }
  const requiredGates = [...new Set([
    ...matched.flatMap(rule => rule.gates),
    ...(effectiveRiskTier === "full-delivery" ? ["delivery-receipt"] : [])
  ])].sort();
  return {
    schemaVersion: 1,
    projectRoot: root,
    requestedRiskTier: riskTier,
    effectiveRiskTier,
    changeKind,
    changedFiles: files,
    requiredGates,
    testClosure: verifierClosure(testIds, policy.verifiers, files, reasons),
    lintClosure: verifierClosure(lintIds, policy.verifiers, files, reasons),
    documentationClosure: [...new Set(matched.flatMap(rule => rule.documentation))].sort(),
    ciClosure: [...new Set(matched.flatMap(rule => rule.ci))].sort(),
    unmappedPaths,
    escalationReason: [...new Set(escalationReason)].sort()
  };
}

function parseArgs(args) {
  const options = {changedFiles: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--risk-tier", "--change-kind", "--changed-file"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--changed-file") options.changedFiles.push(value);
      else options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (["--help", "-h"].includes(argument)) options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function usage() {
  return "用法：verification-plan.mjs --project <项目目录> --risk-tier read-only|local-only|isolated|full-delivery --change-kind <类型> --changed-file <相对路径> [--changed-file ...]";
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.project) throw new Error("--project requires a value");
  process.stdout.write(`${JSON.stringify(buildVerificationPlan({
    projectRoot: options.project,
    riskTier: options.risk_tier,
    changeKind: options.change_kind,
    changedFiles: options.changedFiles
  }), null, 2)}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`verification planning failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
