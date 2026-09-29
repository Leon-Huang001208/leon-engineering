import fs from "node:fs";
import path from "node:path";

const TOP_LEVEL_KEYS = new Set(["schemaVersion", "entrypoints", "roots", "documentClasses", "modules"]);
const ROOT_KEYS = new Set(["path", "owner"]);
const DOCUMENT_CLASS_KEYS = new Set(["current", "decisions", "plans", "evidence", "generated", "archive"]);
const MODULE_KEYS = new Set([
  "id",
  "responsibility",
  "sources",
  "documentation",
  "tests",
  "documentationTriggers",
]);
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,79}$/;

export class ArchitectureMapError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new ArchitectureMapError(code, message);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MAP_ERROR", `invalid ${label}`);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some(key => !expected.has(key))) {
    fail("MAP_ERROR", `invalid ${label} keys`);
  }
}

function assertUniqueStringArray(value, label, {nonEmpty = false} = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) fail("MAP_ERROR", `invalid ${label}`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) fail("MAP_ERROR", `invalid ${label}`);
    seen.add(item);
  }
  return value;
}

function normalizeRelative(value) {
  if (typeof value !== "string" || value.length === 0 || /[\x00-\x1f\\]/.test(value) || path.posix.isAbsolute(value)) {
    fail("PATH_ERROR", "unsafe architecture path");
  }
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized !== value) {
    fail("PATH_ERROR", "unsafe architecture path");
  }
  return normalized;
}

function safeProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) fail("PROJECT_ERROR", "invalid project root");
  let metadata;
  try {
    metadata = fs.lstatSync(projectRoot);
  } catch {
    fail("PROJECT_ERROR", "project root is unavailable");
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail("PROJECT_ERROR", "project root must be a real directory");
  return fs.realpathSync(projectRoot);
}

function safeExistingPath(root, relative) {
  const normalized = normalizeRelative(relative);
  let current = root;
  for (const component of normalized.split("/")) {
    current = path.join(current, component);
    let metadata;
    try {
      metadata = fs.lstatSync(current);
    } catch {
      fail("PATH_ERROR", `missing architecture path: ${normalized}`);
    }
    if (metadata.isSymbolicLink()) fail("PATH_ERROR", "symbolic links are not allowed");
  }
  return normalized;
}

function readMap(root, mapPath) {
  const relative = safeExistingPath(root, mapPath);
  const destination = path.join(root, relative);
  if (!fs.statSync(destination).isFile()) fail("MAP_ERROR", "architecture map must be a regular file");
  try {
    return JSON.parse(fs.readFileSync(destination, "utf8"));
  } catch {
    fail("MAP_ERROR", "architecture map is not valid JSON");
  }
}

export function validateArchitectureMap({projectRoot, mapPath = "docs/architecture-map.json"}) {
  const root = safeProjectRoot(projectRoot);
  const value = readMap(root, mapPath);
  assertExactKeys(value, TOP_LEVEL_KEYS, "architecture map");
  if (value.schemaVersion !== 1) fail("MAP_ERROR", "unsupported architecture map schema");

  const referenced = new Set([normalizeRelative(mapPath)]);
  const checkPaths = (values, label, options) => {
    for (const entry of assertUniqueStringArray(values, label, options)) {
      referenced.add(safeExistingPath(root, entry));
    }
  };

  checkPaths(value.entrypoints, "entrypoints", {nonEmpty: true});
  assertExactKeys(value.documentClasses, DOCUMENT_CLASS_KEYS, "document classes");
  for (const [name, values] of Object.entries(value.documentClasses)) checkPaths(values, `${name} documents`);

  if (!Array.isArray(value.modules) || value.modules.length === 0) fail("MAP_ERROR", "architecture modules are required");
  const moduleIds = new Set();
  const sourceOwners = new Map();
  for (const module of value.modules) {
    assertExactKeys(module, MODULE_KEYS, "module");
    if (typeof module.id !== "string" || !IDENTIFIER.test(module.id)) fail("MAP_ERROR", "invalid module id");
    if (moduleIds.has(module.id)) fail("MAP_ERROR", `duplicate module id: ${module.id}`);
    moduleIds.add(module.id);
    if (typeof module.responsibility !== "string" || module.responsibility.trim().length === 0) {
      fail("MAP_ERROR", "invalid module responsibility");
    }
    checkPaths(module.sources, `${module.id} sources`, {nonEmpty: true});
    checkPaths(module.documentation, `${module.id} documentation`, {nonEmpty: true});
    checkPaths(module.tests, `${module.id} tests`, {nonEmpty: true});
    assertUniqueStringArray(module.documentationTriggers, `${module.id} documentation triggers`, {nonEmpty: true});
    for (const source of module.sources) {
      if (sourceOwners.has(source)) fail("MAP_ERROR", `duplicate source authority: ${source}`);
      sourceOwners.set(source, module.id);
    }
  }

  if (!Array.isArray(value.roots) || value.roots.length === 0) fail("MAP_ERROR", "architecture roots are required");
  const roots = new Set();
  for (const item of value.roots) {
    assertExactKeys(item, ROOT_KEYS, "root");
    const rootPath = safeExistingPath(root, item.path);
    if (roots.has(rootPath)) fail("MAP_ERROR", `duplicate architecture root: ${rootPath}`);
    roots.add(rootPath);
    referenced.add(rootPath);
    if (!moduleIds.has(item.owner)) fail("MAP_ERROR", `unknown root owner: ${item.owner}`);
  }

  return {
    schemaVersion: 1,
    valid: true,
    moduleCount: value.modules.length,
    referencedPathCount: referenced.size,
  };
}
