import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";

import {validateArchitectureMap} from "../lib/governance/architecture-map.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function writeFile(root, relative, content = `${relative}\n`) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, content);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-architecture-map-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const relative of [
    "README.md",
    "AGENTS.md",
    "docs/ARCHITECTURE.md",
    "docs/DEVELOPMENT_MAP.md",
    "src/alpha.mjs",
    "docs/alpha.md",
    "tests/alpha.test.mjs",
  ]) writeFile(root, relative);
  const value = {
    schemaVersion: 1,
    entrypoints: ["README.md", "AGENTS.md", "docs/ARCHITECTURE.md", "docs/DEVELOPMENT_MAP.md"],
    roots: [
      {path: "src", owner: "alpha"},
      {path: "docs", owner: "alpha"},
      {path: "tests", owner: "alpha"},
    ],
    documentClasses: {
      current: ["README.md", "AGENTS.md", "docs/ARCHITECTURE.md", "docs/DEVELOPMENT_MAP.md"],
      decisions: [],
      plans: [],
      evidence: [],
      generated: [],
      archive: [],
    },
    modules: [{
      id: "alpha",
      responsibility: "Own the alpha example.",
      sources: ["src/alpha.mjs"],
      documentation: ["docs/alpha.md"],
      tests: ["tests/alpha.test.mjs"],
      documentationTriggers: ["Public alpha behavior changes."],
    }],
  };
  writeFile(root, "docs/architecture-map.json", `${JSON.stringify(value, null, 2)}\n`);
  return {root, value};
}

function overwrite(root, value) {
  writeFile(root, "docs/architecture-map.json", `${JSON.stringify(value, null, 2)}\n`);
}

test("the repository architecture map resolves every current entrypoint and module asset", () => {
  const result = validateArchitectureMap({projectRoot: REPOSITORY_ROOT});
  assert.deepEqual(result, {
    schemaVersion: 1,
    valid: true,
    moduleCount: 10,
    referencedPathCount: result.referencedPathCount,
  });
  assert.ok(result.referencedPathCount >= 40);
});

test("rejects a missing entrypoint and a missing module document or test", t => {
  const {root, value} = fixture(t);
  value.entrypoints.push("docs/MISSING.md");
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /missing architecture path/);

  value.entrypoints.pop();
  value.modules[0].documentation = ["docs/MISSING.md"];
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /missing architecture path/);
});

test("rejects duplicate module ids and duplicate source authority", t => {
  const {root, value} = fixture(t);
  value.modules.push({...value.modules[0]});
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /duplicate module id/);

  value.modules[1] = {
    ...value.modules[0],
    id: "beta",
    responsibility: "Own beta.",
  };
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /duplicate source authority/);
});

test("rejects unsafe, symbolic-link, and unknown root ownership", t => {
  const {root, value} = fixture(t);
  value.modules[0].sources = ["../outside.mjs"];
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /unsafe architecture path/);

  value.modules[0].sources = ["src/link.mjs"];
  fs.symlinkSync(path.join(root, "src", "alpha.mjs"), path.join(root, "src", "link.mjs"));
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /symbolic links are not allowed/);

  value.modules[0].sources = ["src/alpha.mjs"];
  writeFile(root, "plugins/README.md");
  value.roots.push({path: "plugins", owner: "missing-owner"});
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /unknown root owner/);
});

test("architecture inventory never claims verification execution", t => {
  const {root, value} = fixture(t);
  value.modules[0].passed = true;
  overwrite(root, value);
  assert.throws(() => validateArchitectureMap({projectRoot: root}), /invalid module keys/);
});

test("thin CLI emits the same validation receipt", () => {
  const result = spawnSync(process.execPath, [
    path.join(REPOSITORY_ROOT, "scripts", "check-architecture-map.mjs"),
    "--project",
    REPOSITORY_ROOT,
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
});
