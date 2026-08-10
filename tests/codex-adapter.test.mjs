import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  install,
  verify,
  rollback,
  SKILL_NAMES,
  GLOBAL_DOCUMENT_NAMES,
  installGlobalFramework,
  verifyGlobalFramework,
  rollbackGlobalFramework
} from "../scripts/install-codex-adapter.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function makeTarget(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "leon-codex-adapter-"));
  t.after(() => fs.rmSync(target, {recursive: true, force: true}));
  return target;
}

function makeCodexHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leon-codex-global-"));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  return home;
}

test("installs the global framework without replacing custom global rules", t => {
  const codexHome = makeCodexHome(t);
  const original = "# User rules\n\nKeep this text.\n";
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), original);

  const result = installGlobalFramework({sourceRoot, codexHome});
  assert.deepEqual(result.documents, GLOBAL_DOCUMENT_NAMES);
  assert.equal(verifyGlobalFramework({sourceRoot, codexHome}).valid, true);

  const agents = fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8");
  assert.match(agents, /^# User rules/m);
  assert.match(agents, /Keep this text\./);
  assert.match(agents, /leon-engineering:global-framework:start/);
  const hooks = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"));
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /harness-hook\.mjs --phase pre --host codex/);
  const manifest = JSON.parse(fs.readFileSync(path.join(codexHome, ".leon-engineering-global.json"), "utf8"));
  assert.match(manifest.hooks.checksum, /^[0-9a-f]{64}$/);
  for (const name of GLOBAL_DOCUMENT_NAMES) {
    assert.equal(fs.existsSync(path.join(codexHome, "docs", name)), true);
  }
});

test("refuses to replace a foreign global hook file", t => {
  const codexHome = makeCodexHome(t);
  const foreign = JSON.stringify({hooks: {PreToolUse: []}}, null, 2);
  fs.writeFileSync(path.join(codexHome, "hooks.json"), foreign);

  assert.throws(
    () => installGlobalFramework({sourceRoot, codexHome}),
    /foreign global hooks/
  );
  assert.equal(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"), foreign);
  assert.equal(fs.existsSync(path.join(codexHome, ".leon-engineering-global.json")), false);
});

test("detects global hook drift and refuses to roll it back", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  fs.appendFileSync(path.join(codexHome, "hooks.json"), "\nchanged");

  assert.deepEqual(verifyGlobalFramework({sourceRoot, codexHome}).drift, ["hooks"]);
  assert.throws(() => rollbackGlobalFramework({sourceRoot, codexHome}), /drifted global framework/);
});

test("adopts a matching legacy hook file and preserves it on rollback", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const hooksPath = path.join(codexHome, "hooks.json");
  const matchingLegacyHooks = fs.readFileSync(hooksPath, "utf8");
  const manifestPath = path.join(codexHome, ".leon-engineering-global.json");
  const legacyManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete legacyManifest.hooks;
  fs.writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);

  installGlobalFramework({sourceRoot, codexHome});
  assert.equal(verifyGlobalFramework({sourceRoot, codexHome}).valid, true);
  rollbackGlobalFramework({sourceRoot, codexHome});

  assert.equal(fs.readFileSync(hooksPath, "utf8"), matchingLegacyHooks);
});

test("rejects a foreign global document before installing the framework", t => {
  const codexHome = makeCodexHome(t);
  const docs = path.join(codexHome, "docs");
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, "GETTING_STARTED.md"), "foreign");

  assert.throws(
    () => installGlobalFramework({sourceRoot, codexHome}),
    /foreign global document: GETTING_STARTED\.md/
  );
  assert.equal(fs.readFileSync(path.join(docs, "GETTING_STARTED.md"), "utf8"), "foreign");
  assert.equal(fs.existsSync(path.join(codexHome, ".leon-engineering-global.json")), false);
});

test("reports global drift and rolls back only framework-owned content", t => {
  const codexHome = makeCodexHome(t);
  const original = "# User rules\n";
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), original);
  installGlobalFramework({sourceRoot, codexHome});

  fs.appendFileSync(path.join(codexHome, "docs", "SKILLS_GUIDE.md"), "changed\n");
  assert.deepEqual(
    verifyGlobalFramework({sourceRoot, codexHome}).drift,
    ["document:SKILLS_GUIDE.md"]
  );
  assert.throws(() => rollbackGlobalFramework({codexHome}), /drifted global framework/);

  installGlobalFramework({sourceRoot, codexHome});
  rollbackGlobalFramework({codexHome});
  assert.equal(fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8"), original);
  assert.equal(fs.existsSync(path.join(codexHome, "docs", "SKILLS_GUIDE.md")), false);
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
});

test("installs and verifies the global framework through the command line", t => {
  const codexHome = makeCodexHome(t);
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");

  const installed = spawnSync(
    process.execPath,
    [script, "--install-global", "--codex-home", codexHome],
    {encoding: "utf8"}
  );
  assert.equal(installed.status, 0, installed.stderr);

  const verified = spawnSync(
    process.execPath,
    [script, "--verify-global", "--codex-home", codexHome],
    {encoding: "utf8"}
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /"valid": true/);
});

test("redacts user AGENTS.md text from successful global CLI installation output", t => {
  const codexHome = makeCodexHome(t);
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");
  const sentinel = "USER_PRIVATE_SENTINEL_CODEX_GLOBAL_INSTALL";
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), `# User rules\n${sentinel}\n`);

  const installed = spawnSync(
    process.execPath,
    [script, "--install-global", "--codex-home", codexHome],
    {encoding: "utf8"}
  );

  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout, new RegExp(sentinel));
  assert.doesNotMatch(installed.stderr, new RegExp(sentinel));
  assert.equal(
    installed.stderr,
    '{"component":"codex-adapter","event":"global_installed","documentCount":6}\n'
  );
  assert.deepEqual(JSON.parse(installed.stdout), {
    installed: true,
    documents: GLOBAL_DOCUMENT_NAMES,
    frameworkVersion: JSON.parse(
      fs.readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"), "utf8")
    ).version
  });
});

test("installs every canonical skill and writes a checksum manifest", t => {
  const target = makeTarget(t);
  const result = install({sourceRoot, targetRoot: target});

  assert.deepEqual(result.skills, SKILL_NAMES);
  assert.equal(verify({sourceRoot, targetRoot: target}).valid, true);

  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".leon-engineering.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.skills).sort(), SKILL_NAMES);
  assert.match(
    fs.readFileSync(
      path.join(target, "agent-routing", "references", "codex-role-templates.md"),
      "utf8"
    ),
    /## repo-explorer/
  );
});

test("refuses to overwrite a foreign skill directory", t => {
  const target = makeTarget(t);
  fs.mkdirSync(path.join(target, "feature-loop"));
  fs.writeFileSync(path.join(target, "feature-loop", "SKILL.md"), "foreign");

  assert.throws(() => install({sourceRoot, targetRoot: target}), /foreign skill directory/);
  assert.equal(fs.readFileSync(path.join(target, "feature-loop", "SKILL.md"), "utf8"), "foreign");
});

test("detects drift and preserves unrelated skills during rollback", t => {
  const target = makeTarget(t);
  install({sourceRoot, targetRoot: target});
  fs.appendFileSync(path.join(target, "bugfix-evidence", "SKILL.md"), "\nchanged");

  assert.deepEqual(verify({sourceRoot, targetRoot: target}).drift, ["bugfix-evidence"]);

  fs.mkdirSync(path.join(target, "pdf"));
  fs.writeFileSync(path.join(target, "pdf", "SKILL.md"), "existing");
  rollback({targetRoot: target});

  assert.equal(fs.existsSync(path.join(target, "feature-loop")), false);
  assert.equal(fs.readFileSync(path.join(target, "pdf", "SKILL.md"), "utf8"), "existing");
});
