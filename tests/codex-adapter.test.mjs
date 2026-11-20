import fs from "node:fs";
import crypto from "node:crypto";
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
  migrateToPluginDistribution,
  verifyPluginDistribution,
  rollbackPluginDistribution,
  GLOBAL_DOCUMENT_NAMES,
  installGlobalFramework,
  verifyGlobalFramework,
  rollbackGlobalFramework,
  verifyCurrentCodexState
} from "../scripts/install-codex-adapter.mjs";
import {installHarnessRuntime} from "../scripts/harness-runtime.mjs";

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

function makeSourceClone(t) {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "leon-codex-source-"));
  t.after(() => fs.rmSync(clone, {recursive: true, force: true}));
  fs.cpSync(sourceRoot, clone, {
    recursive: true,
    filter: source => path.basename(source) !== ".git" && path.basename(source) !== ".ai"
  });
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Test"],
    ["config", "user.email", "test@example.invalid"],
    ["add", "."],
    ["commit", "-qm", "fixture"]
  ]) {
    const result = spawnSync("git", ["-C", clone, ...args], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
  }
  return clone;
}

function legacyHooksContent() {
  return `${JSON.stringify({
    description: "leon-engineering legacy Harness",
    hooks: {
      PreToolUse: [{matcher: "Bash|Edit|Write", hooks: [{
        type: "command",
        command: "node /Users/example/.agents/leon-engineering/runtime/harness-hook.mjs --phase pre --host codex"
      }]}],
      PostToolUse: [{matcher: "Bash|Edit|Write", hooks: [{
        type: "command",
        command: "node /Users/example/.agents/leon-engineering/runtime/harness-hook.mjs --phase post --host codex"
      }]}]
    }
  }, null, 2)}\n`;
}

function attachLegacyHooks(codexHome, content = legacyHooksContent()) {
  const hooksPath = path.join(codexHome, "hooks.json");
  fs.writeFileSync(hooksPath, content);
  const file = path.join(codexHome, ".leon-engineering-global.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.hooks = {
    checksum: crypto.createHash("sha256").update(content).digest("hex"),
    hadHooksFile: false
  };
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return content;
}

test("installs the global framework without replacing custom global rules", t => {
  const codexHome = makeCodexHome(t);
  const original = "# User rules\n\nKeep this text.\n";
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), original);

  const result = installGlobalFramework({sourceRoot, codexHome});
  const repeated = installGlobalFramework({sourceRoot, codexHome});
  assert.deepEqual(result.documents, GLOBAL_DOCUMENT_NAMES);
  assert.deepEqual(repeated.documents, GLOBAL_DOCUMENT_NAMES);
  assert.equal(verifyGlobalFramework({sourceRoot, codexHome}).valid, true);

  const agents = fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8");
  assert.match(agents, /^# User rules/m);
  assert.match(agents, /Keep this text\./);
  assert.match(agents, /leon-engineering:global-framework:start/);
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(codexHome, ".leon-engineering-global.json"), "utf8"));
  assert.equal(manifest.hooks, undefined);
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

test("a dangling global hook registration is not mistaken for absence", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const hooksPath = path.join(codexHome, "hooks.json");
  fs.symlinkSync(path.join(codexHome, "missing-hook-target.json"), hooksPath);

  assert.deepEqual(verifyGlobalFramework({sourceRoot, codexHome}).drift, ["hooks"]);
  assert.throws(() => installGlobalFramework({sourceRoot, codexHome}), /global hooks\.json is not a file/);
  assert.equal(fs.lstatSync(hooksPath).isSymbolicLink(), true);
});

test("detects global hook drift and refuses to roll it back", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  attachLegacyHooks(codexHome);
  fs.appendFileSync(path.join(codexHome, "hooks.json"), "\nchanged");

  assert.deepEqual(verifyGlobalFramework({sourceRoot, codexHome}).drift, ["hooks"]);
  assert.throws(() => installGlobalFramework({sourceRoot, codexHome}), /drifted global hooks/);
  assert.throws(() => rollbackGlobalFramework({sourceRoot, codexHome}), /drifted global framework/);
});

test("retires checksum-owned legacy hooks to a backup without recreating them", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const original = attachLegacyHooks(codexHome);
  const hooksPath = path.join(codexHome, "hooks.json");
  assert.deepEqual(verifyGlobalFramework({sourceRoot, codexHome}).drift, ["hooks"]);
  const migrated = installGlobalFramework({sourceRoot, codexHome});

  assert.equal(fs.existsSync(hooksPath), false);
  assert.equal(fs.readFileSync(migrated.removedLegacyHooks.backupPath, "utf8"), original);
  assert.equal(migrated.manifest.hooks, undefined);
  assert.equal(migrated.activation.status, "restart_required");
  assert.equal(migrated.activation.scope, "codex_host_process");
  assert.equal(verifyGlobalFramework({sourceRoot, codexHome}).valid, true);
  assert.equal(installGlobalFramework({sourceRoot, codexHome}).removedLegacyHooks, undefined);
  assert.equal(fs.existsSync(hooksPath), false);
});

test("does not restore a missing legacy hook from its old manifest", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  attachLegacyHooks(codexHome);
  const hooksPath = path.join(codexHome, "hooks.json");
  fs.rmSync(hooksPath);

  installGlobalFramework({sourceRoot, codexHome});
  assert.equal(verifyGlobalFramework({sourceRoot, codexHome}).valid, true);
  assert.equal(fs.existsSync(hooksPath), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(codexHome, ".leon-engineering-global.json")));
  assert.equal(manifest.hooks, undefined);
});

test("does not adopt legacy-looking hooks without checksum ownership", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const hooksPath = path.join(codexHome, "hooks.json");
  const matchingLegacyHooks = legacyHooksContent();
  fs.writeFileSync(hooksPath, matchingLegacyHooks);

  assert.throws(() => installGlobalFramework({sourceRoot, codexHome}), /foreign global hooks/);
  assert.equal(fs.readFileSync(hooksPath, "utf8"), matchingLegacyHooks);
});

test("preserves mixed foreign hook commands even when an old manifest checksum matches", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const mixed = JSON.parse(legacyHooksContent());
  mixed.hooks.PreToolUse[0].hooks.push({type: "command", command: "echo foreign"});
  const content = attachLegacyHooks(codexHome, `${JSON.stringify(mixed, null, 2)}\n`);

  assert.throws(() => installGlobalFramework({sourceRoot, codexHome}), /foreign global hooks/);
  assert.equal(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"), content);
});

test("does not retire disguised, compound, or mismatched legacy commands with matching checksums", t => {
  const script = "/Users/example/.agents/leon-engineering/runtime/harness-hook.mjs";
  const commands = [
    `echo ${script} --phase pre --host codex`,
    `node ${script} --phase pre --host codex && echo foreign`,
    `node ${script} --phase pre --host codex; echo foreign`,
    `node ${script} --phase pre --host codex | tee foreign`,
    `/tmp/node ${script} --phase pre --host codex`,
    `node ${script} --phase post --host codex`,
    `node ${script} --phase pre --host claude`
  ];

  for (const command of commands) {
    const codexHome = makeCodexHome(t);
    installGlobalFramework({sourceRoot, codexHome});
    const hooks = JSON.parse(legacyHooksContent());
    hooks.hooks.PreToolUse[0].hooks[0].command = command;
    const content = attachLegacyHooks(codexHome, `${JSON.stringify(hooks, null, 2)}\n`);
    const beforeManifest = fs.readFileSync(path.join(codexHome, ".leon-engineering-global.json"), "utf8");

    assert.throws(() => installGlobalFramework({sourceRoot, codexHome}), /foreign global hooks/, command);
    assert.equal(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"), content);
    assert.equal(fs.readFileSync(path.join(codexHome, ".leon-engineering-global.json"), "utf8"), beforeManifest);
    assert.equal(fs.existsSync(path.join(codexHome, ".leon-engineering-backups")), false);
  }
});

test("retires exact legacy Node commands including quoted absolute script paths", t => {
  const script = "/Users/example profile/.agents/leon-engineering/runtime/harness-hook.mjs";
  for (const node of ["node", process.execPath, "/opt/homebrew/bin/node"]) {
    const codexHome = makeCodexHome(t);
    installGlobalFramework({sourceRoot, codexHome});
    const hooks = JSON.parse(legacyHooksContent());
    hooks.hooks.PreToolUse[0].hooks[0].command = `"${node}" "${script}" --phase pre --host codex`;
    const content = attachLegacyHooks(codexHome, `${JSON.stringify(hooks, null, 2)}\n`);

    const result = installGlobalFramework({sourceRoot, codexHome});
    assert.equal(fs.readFileSync(result.removedLegacyHooks.backupPath, "utf8"), content);
    assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
  }
});

test("preserves legacy-looking commands with shell glob characters even when quoted", t => {
  for (const pattern of ["*", "?", "[ab]", "{a,b}"]) {
    for (const quote of ["", '"', "'"]) {
      const codexHome = makeCodexHome(t);
      installGlobalFramework({sourceRoot, codexHome});
      const hooks = JSON.parse(legacyHooksContent());
      const script = `/Users/example${pattern}/.agents/leon-engineering/runtime/harness-hook.mjs`;
      const command = `node ${quote}${script}${quote} --phase pre --host codex`;
      hooks.hooks.PreToolUse[0].hooks[0].command = command;
      const content = attachLegacyHooks(codexHome, `${JSON.stringify(hooks, null, 2)}\n`);
      const manifestPath = path.join(codexHome, ".leon-engineering-global.json");
      const beforeManifest = fs.readFileSync(manifestPath, "utf8");

      assert.throws(() => installGlobalFramework({sourceRoot, codexHome}), /foreign global hooks/, command);
      assert.equal(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"), content);
      assert.equal(fs.readFileSync(manifestPath, "utf8"), beforeManifest);
      assert.equal(fs.existsSync(path.join(codexHome, ".leon-engineering-backups")), false);
    }
  }
});

test("detects stale plugin-cache hook registration after a same-version source refresh", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"))).version;
  const cachedHooks = path.join(codexHome, "plugins", "cache", "leon-local", "leon-engineering", version, "hooks", "hooks.json");
  fs.mkdirSync(path.dirname(cachedHooks), {recursive: true});
  fs.writeFileSync(cachedHooks, legacyHooksContent());

  assert.deepEqual(verifyGlobalFramework({sourceRoot, codexHome}).drift, ["hooks:plugin-registration"]);
  fs.rmSync(cachedHooks);
  assert.equal(verifyGlobalFramework({sourceRoot, codexHome}).valid, true);
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
  const runtimeRoot = path.join(codexHome, "runtime");
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");

  const installed = spawnSync(
    process.execPath,
    [script, "--install-global", "--codex-home", codexHome, "--runtime-root", runtimeRoot],
    {encoding: "utf8"}
  );
  assert.equal(installed.status, 0, installed.stderr);

  const verified = spawnSync(
    process.execPath,
    [script, "--verify-global", "--codex-home", codexHome, "--runtime-root", runtimeRoot],
    {encoding: "utf8"}
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /"valid": true/);
  assert.equal(fs.existsSync(runtimeRoot), false);
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
  assert.equal(JSON.parse(verified.stdout).runtime.status, "NOT_INSTALLED");
});

test("basic current verification does not require an optional runtime", t => {
  const codexHome = makeCodexHome(t);
  const targetRoot = path.join(codexHome, "skills");
  const runtimeRoot = path.join(codexHome, "runtime");
  install({sourceRoot, targetRoot});
  migrateToPluginDistribution({sourceRoot, targetRoot});
  installGlobalFramework({sourceRoot, codexHome});

  const report = verifyCurrentCodexState({sourceRoot, targetRoot, codexHome, runtimeRoot});
  assert.equal(report.valid, true);
  assert.deepEqual(report.runtime, {valid: true, drift: [], installed: false, status: "NOT_INSTALLED"});
  assert.equal(fs.existsSync(runtimeRoot), false);

  fs.mkdirSync(runtimeRoot);
  const partial = verifyCurrentCodexState({sourceRoot, targetRoot, codexHome, runtimeRoot});
  assert.equal(partial.valid, false);
  assert.equal(partial.runtime.valid, false);
});

test("a dangling runtime path is invalid rather than reported as not installed", t => {
  const codexHome = makeCodexHome(t);
  const targetRoot = path.join(codexHome, "skills");
  const runtimeRoot = path.join(codexHome, "runtime");
  install({sourceRoot, targetRoot});
  migrateToPluginDistribution({sourceRoot, targetRoot});
  installGlobalFramework({sourceRoot, codexHome});
  fs.symlinkSync(path.join(codexHome, "missing-runtime-target"), runtimeRoot, "dir");

  const report = verifyCurrentCodexState({sourceRoot, targetRoot, codexHome, runtimeRoot});
  assert.equal(report.valid, false);
  assert.equal(report.runtime.valid, false);
  assert.notEqual(report.runtime.status, "NOT_INSTALLED");
});

test("global CLI leaves an existing optional runtime directory untouched", t => {
  const codexHome = makeCodexHome(t);
  const runtimeRoot = path.join(codexHome, "runtime");
  fs.mkdirSync(runtimeRoot);
  fs.writeFileSync(path.join(runtimeRoot, "existing-runtime-file"), "keep exact bytes\n");
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");

  const installed = spawnSync(process.execPath, [
    script, "--install-global", "--codex-home", codexHome, "--runtime-root", runtimeRoot
  ], {encoding: "utf8"});
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(fs.readdirSync(runtimeRoot), ["existing-runtime-file"]);
  assert.equal(fs.readFileSync(path.join(runtimeRoot, "existing-runtime-file"), "utf8"), "keep exact bytes\n");
});

test("global CLI returns a verifiable backup reference when retiring legacy hooks", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  const original = attachLegacyHooks(codexHome);
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");
  const installed = spawnSync(process.execPath, [
    script, "--install-global", "--codex-home", codexHome
  ], {encoding: "utf8"});

  assert.equal(installed.status, 0, installed.stderr);
  const report = JSON.parse(installed.stdout);
  assert.equal(fs.readFileSync(report.removedLegacyHooks.backupPath, "utf8"), original);
  assert.equal(report.removedLegacyHooks.checksum, crypto.createHash("sha256").update(original).digest("hex"));
  assert.equal(report.activation.status, "restart_required");
  assert.equal(report.activation.scope, "codex_host_process");
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
});

test("global CLI reports restart for a legacy manifest even when its hook file is already absent", t => {
  const codexHome = makeCodexHome(t);
  installGlobalFramework({sourceRoot, codexHome});
  attachLegacyHooks(codexHome);
  fs.rmSync(path.join(codexHome, "hooks.json"));
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");

  const installed = spawnSync(process.execPath, [
    script, "--install-global", "--codex-home", codexHome
  ], {encoding: "utf8"});
  assert.equal(installed.status, 0, installed.stderr);
  const report = JSON.parse(installed.stdout);
  assert.equal(report.activation.status, "restart_required");
  assert.equal(report.activation.scope, "codex_host_process");
  assert.equal(report.removedLegacyHooks, undefined);
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
});

test("migration-aware default verification composes plugin, global, and runtime health", t => {
  const codexHome = makeCodexHome(t);
  const targetRoot = path.join(codexHome, "skills");
  const runtimeRoot = path.join(codexHome, "runtime");
  install({sourceRoot, targetRoot});
  migrateToPluginDistribution({sourceRoot, targetRoot});
  installGlobalFramework({sourceRoot, codexHome});
  installHarnessRuntime({sourceRoot, runtimeRoot});

  assert.deepEqual(verifyCurrentCodexState({
    sourceRoot,
    targetRoot,
    codexHome,
    runtimeRoot,
    explicitTarget: false
  }), {
    valid: true,
    drift: [],
    pluginDistribution: {valid: true, drift: []},
    globalFramework: {valid: true, drift: []},
    runtime: {valid: true, drift: []}
  });

  fs.appendFileSync(path.join(runtimeRoot, "harness-storage.mjs"), "\n// drift\n");
  const drifted = verifyCurrentCodexState({
    sourceRoot,
    targetRoot,
    codexHome,
    runtimeRoot,
    explicitTarget: false
  });
  assert.equal(drifted.valid, false);
  assert.equal(drifted.pluginDistribution.valid, true);
  assert.equal(drifted.globalFramework.valid, true);
  assert.equal(drifted.runtime.valid, false);
  assert.ok(drifted.drift.some(item => item.startsWith("runtime:")));
});

test("default verify CLI reports composed current Codex health", t => {
  const codexHome = makeCodexHome(t);
  const targetRoot = path.join(codexHome, "skills");
  const runtimeRoot = path.join(codexHome, "runtime");
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");
  install({sourceRoot, targetRoot});
  migrateToPluginDistribution({sourceRoot, targetRoot});
  installGlobalFramework({sourceRoot, codexHome});
  installHarnessRuntime({sourceRoot, runtimeRoot});

  const result = spawnSync(process.execPath, [
    script, "--verify", "--codex-home", codexHome, "--runtime-root", runtimeRoot
  ], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.deepEqual(report.drift, []);
  assert.equal(report.pluginDistribution.valid, true);
  assert.equal(report.globalFramework.valid, true);
  assert.equal(report.runtime.valid, true);
});

test("explicit target verify CLI preserves the legacy skill result", t => {
  const targetRoot = makeTarget(t);
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");
  install({sourceRoot, targetRoot});

  const result = spawnSync(process.execPath, [script, "--verify", "--target", targetRoot], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {valid: true, drift: []});
});

test("redacts user AGENTS.md text from successful global CLI installation output", t => {
  const codexHome = makeCodexHome(t);
  const runtimeRoot = path.join(codexHome, "runtime");
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");
  const sentinel = "USER_PRIVATE_SENTINEL_CODEX_GLOBAL_INSTALL";
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), `# User rules\n${sentinel}\n`);

  const installed = spawnSync(
    process.execPath,
    [script, "--install-global", "--codex-home", codexHome, "--runtime-root", runtimeRoot],
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
    ).version,
    activation: {
      status: "new_session_required",
      scope: "codex_instructions",
      note: "No automatic hooks or Harness runtime are installed. Start a new session to load changed instructions."
    }
  });
  assert.equal(fs.existsSync(runtimeRoot), false);
  assert.equal(fs.existsSync(path.join(codexHome, "hooks.json")), false);
});

test("installs every canonical skill and writes a checksum manifest", t => {
  const target = makeTarget(t);
  const result = install({sourceRoot, targetRoot: target});

  assert.deepEqual(result.skills, SKILL_NAMES);
  assert.equal(verify({sourceRoot, targetRoot: target}).valid, true);

  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".leon-engineering.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.skills).sort(), [...SKILL_NAMES].sort());
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

test("detects drift and refuses rollback without removing managed or unrelated skills", t => {
  const target = makeTarget(t);
  install({sourceRoot, targetRoot: target});
  fs.appendFileSync(path.join(target, "bugfix-evidence", "SKILL.md"), "\nchanged");

  assert.deepEqual(verify({sourceRoot, targetRoot: target}).drift, ["bugfix-evidence"]);

  fs.mkdirSync(path.join(target, "pdf"));
  fs.writeFileSync(path.join(target, "pdf", "SKILL.md"), "existing");
  assert.throws(
    () => rollback({targetRoot: target}),
    /refusing to rollback drifted skills: bugfix-evidence/
  );

  assert.equal(fs.existsSync(path.join(target, "feature-loop")), true);
  assert.equal(fs.readFileSync(path.join(target, "bugfix-evidence", "SKILL.md"), "utf8").endsWith("\nchanged"), true);
  assert.equal(fs.readFileSync(path.join(target, "pdf", "SKILL.md"), "utf8"), "existing");
});

test("skill verification CLI exits nonzero when managed content drifts", t => {
  const target = makeTarget(t);
  const script = path.join(sourceRoot, "scripts", "install-codex-adapter.mjs");
  install({sourceRoot, targetRoot: target});
  fs.appendFileSync(path.join(target, "project-harness", "SKILL.md"), "\ndrift\n");

  const result = spawnSync(process.execPath, [script, "--verify", "--target", target], {encoding: "utf8"});

  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.match(result.stdout, /project-harness/);
});

test("migrates checksum-owned global skills to plugin-only distribution and restores them exactly", t => {
  const codexHome = makeCodexHome(t);
  const target = path.join(codexHome, "skills");
  install({sourceRoot, targetRoot: target});
  const before = Object.fromEntries(SKILL_NAMES.map(name => [
    name,
    fs.readFileSync(path.join(target, name, "SKILL.md"), "utf8")
  ]));
  fs.mkdirSync(path.join(target, "foreign-skill"));
  fs.writeFileSync(path.join(target, "foreign-skill", "SKILL.md"), "foreign\n");

  const migrated = migrateToPluginDistribution({sourceRoot, targetRoot: target});

  assert.equal(migrated.retiredSkills.length, SKILL_NAMES.length);
  assert.equal(verifyPluginDistribution({sourceRoot, targetRoot: target}).valid, true);
  for (const name of SKILL_NAMES) assert.equal(fs.existsSync(path.join(target, name)), false);
  assert.equal(fs.readFileSync(path.join(target, "foreign-skill", "SKILL.md"), "utf8"), "foreign\n");

  rollbackPluginDistribution({sourceRoot, targetRoot: target});
  for (const [name, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(path.join(target, name, "SKILL.md"), "utf8"), content);
  }
  assert.equal(verify({sourceRoot, targetRoot: target}).valid, true);
});

test("refuses plugin-only migration when a managed skill drifted", t => {
  const codexHome = makeCodexHome(t);
  const target = path.join(codexHome, "skills");
  install({sourceRoot, targetRoot: target});
  fs.appendFileSync(path.join(target, "project-harness", "SKILL.md"), "drift\n");

  assert.throws(
    () => migrateToPluginDistribution({sourceRoot, targetRoot: target}),
    /refusing to migrate drifted skills: project-harness/
  );
  assert.equal(fs.existsSync(path.join(target, "project-harness")), true);
});

test("plugin-only migration accepts a new canonical version when installed skills still match their old manifest", t => {
  const changingSource = makeSourceClone(t);
  const codexHome = makeCodexHome(t);
  const target = path.join(codexHome, "skills");
  install({sourceRoot: changingSource, targetRoot: target});
  fs.appendFileSync(
    path.join(changingSource, "plugins", "leon-engineering-core", "skills", "project-harness", "SKILL.md"),
    "\nNew canonical release text.\n"
  );
  const commit = spawnSync("git", ["-C", changingSource, "add", "."], {encoding: "utf8"});
  assert.equal(commit.status, 0, commit.stderr);
  const committed = spawnSync("git", ["-C", changingSource, "commit", "-qm", "new version"], {encoding: "utf8"});
  assert.equal(committed.status, 0, committed.stderr);

  const result = migrateToPluginDistribution({sourceRoot: changingSource, targetRoot: target});
  assert.equal(result.retiredSkills.length, SKILL_NAMES.length);
  assert.equal(verifyPluginDistribution({sourceRoot: changingSource, targetRoot: target}).valid, true);
});
