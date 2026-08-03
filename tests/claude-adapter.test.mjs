import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  installClaudePolicy,
  verifyClaudePolicy,
  rollbackClaudePolicy
} from "../scripts/install-claude-adapter.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");
const START = "<!-- leon-engineering:claude-policy:start -->";
const END = "<!-- leon-engineering:claude-policy:end -->";
const MANIFEST = ".leon-engineering-claude-policy.json";

function makeClaudeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "leon-claude-adapter-"));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  return home;
}

test("installs alongside user CLAUDE.md content and restores it exactly", t => {
  const claudeHome = makeClaudeHome(t);
  const original = "# User rules\n\nKeep every byte here.\n";
  fs.writeFileSync(path.join(claudeHome, "CLAUDE.md"), original);

  installClaudePolicy({sourceRoot, claudeHome});

  const installed = fs.readFileSync(path.join(claudeHome, "CLAUDE.md"), "utf8");
  assert.match(installed, /Keep every byte here\./);
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome}).valid, true);

  rollbackClaudePolicy({sourceRoot, claudeHome});
  assert.equal(fs.readFileSync(path.join(claudeHome, "CLAUDE.md"), "utf8"), original);
});

test("refuses a foreign Claude policy block without an owned manifest", t => {
  const claudeHome = makeClaudeHome(t);
  fs.writeFileSync(
    path.join(claudeHome, "CLAUDE.md"),
    `${START}\nforeign\n${END}\n`
  );

  assert.throws(
    () => installClaudePolicy({sourceRoot, claudeHome}),
    /foreign Claude policy block/
  );
});

test("detects policy drift and refuses to roll it back", t => {
  const claudeHome = makeClaudeHome(t);
  installClaudePolicy({sourceRoot, claudeHome});

  const policyFile = path.join(claudeHome, "CLAUDE.md");
  const installed = fs.readFileSync(policyFile, "utf8");
  fs.writeFileSync(policyFile, installed.replace("默认走快路径", "外来改动"));

  assert.deepEqual(
    verifyClaudePolicy({sourceRoot, claudeHome}),
    {valid: false, drift: ["policy"]}
  );
  assert.throws(
    () => rollbackClaudePolicy({sourceRoot, claudeHome}),
    /drifted Claude policy/
  );
});

test("installs and verifies Claude policy through the command line", t => {
  const claudeHome = makeClaudeHome(t);
  const script = path.join(sourceRoot, "scripts", "install-claude-adapter.mjs");

  const installed = spawnSync(
    process.execPath,
    [script, "--install", "--claude-home", claudeHome],
    {encoding: "utf8"}
  );
  assert.equal(installed.status, 0, installed.stderr);

  const verified = spawnSync(
    process.execPath,
    [script, "--verify", "--claude-home", claudeHome],
    {encoding: "utf8"}
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /"valid": true/);
});

test("redacts user CLAUDE.md text from successful CLI installation output", t => {
  const claudeHome = makeClaudeHome(t);
  const script = path.join(sourceRoot, "scripts", "install-claude-adapter.mjs");
  const sentinel = "USER_PRIVATE_SENTINEL_CLAUDE_INSTALL";
  fs.writeFileSync(path.join(claudeHome, "CLAUDE.md"), `# User rules\n${sentinel}\n`);

  const installed = spawnSync(
    process.execPath,
    [script, "--install", "--claude-home", claudeHome],
    {encoding: "utf8"}
  );

  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout, new RegExp(sentinel));
  assert.doesNotMatch(installed.stderr, new RegExp(sentinel));
  assert.equal(
    installed.stderr,
    '{"component":"claude-adapter","event":"installed"}\n'
  );
  assert.deepEqual(JSON.parse(installed.stdout), {
    installed: true,
    frameworkVersion: JSON.parse(
      fs.readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"), "utf8")
    ).version
  });
});

test("fails CLI verification safely when the managed policy has drifted", t => {
  const claudeHome = makeClaudeHome(t);
  const policyFile = path.join(claudeHome, "CLAUDE.md");
  const script = path.join(sourceRoot, "scripts", "install-claude-adapter.mjs");
  const sentinel = "USER_PRIVATE_SENTINEL_9c7e";
  fs.writeFileSync(policyFile, `# User rules\n${sentinel}\n`);
  installClaudePolicy({sourceRoot, claudeHome});
  fs.writeFileSync(
    policyFile,
    fs.readFileSync(policyFile, "utf8").replace("默认走快路径", "外来改动")
  );

  const verified = spawnSync(
    process.execPath,
    [script, "--verify", "--claude-home", claudeHome],
    {encoding: "utf8"}
  );

  assert.equal(verified.status, 1, verified.stderr);
  assert.equal(verified.stdout, "");
  const stderrLines = verified.stderr.trim().split("\n");
  assert.equal(stderrLines.length, 1);
  assert.deepEqual(JSON.parse(stderrLines[0]), {
    component: "claude-adapter",
    event: "command_failed",
    code: "drifted_policy"
  });
  assert.doesNotMatch(verified.stderr, new RegExp(claudeHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(verified.stderr, new RegExp(sentinel));
  assert.doesNotMatch(verified.stderr, /外来改动/);
  assert.doesNotMatch(verified.stderr, /drifted Claude policy/);
});

test("compensates if active manifest promotion fails without leaving adapter files", t => {
  const claudeHome = makeClaudeHome(t);
  const original = "# User rules\n";
  const policyFile = path.join(claudeHome, "CLAUDE.md");
  fs.writeFileSync(policyFile, original);
  const originalRename = fs.renameSync;
  let manifestRenames = 0;

  fs.renameSync = (source, destination) => {
    if (path.basename(destination) === MANIFEST && ++manifestRenames === 2) {
      throw new Error("simulated manifest promotion failure");
    }
    return originalRename(source, destination);
  };
  try {
    assert.throws(
      () => installClaudePolicy({sourceRoot, claudeHome}),
      /simulated manifest promotion failure/
    );
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.readFileSync(policyFile, "utf8"), original);
  assert.equal(fs.existsSync(path.join(claudeHome, MANIFEST)), false);
  assert.deepEqual(fs.readdirSync(claudeHome).filter(name => name.endsWith(".tmp")), []);

  installClaudePolicy({sourceRoot, claudeHome});
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome}).valid, true);
});

test("preserves the installing manifest when snapshot recovery also fails", t => {
  const claudeHome = makeClaudeHome(t);
  const original = "# User rules\n";
  const policyFile = path.join(claudeHome, "CLAUDE.md");
  const manifestPath = path.join(claudeHome, MANIFEST);
  fs.writeFileSync(policyFile, original);
  const originalRename = fs.renameSync;
  let manifestRenames = 0;
  let activeManifestFailed = false;

  fs.renameSync = (source, destination) => {
    if (path.basename(destination) === MANIFEST && ++manifestRenames === 2) {
      activeManifestFailed = true;
      throw new Error("simulated active manifest failure");
    }
    if (activeManifestFailed && destination === policyFile) {
      throw new Error("simulated snapshot recovery failure");
    }
    return originalRename(source, destination);
  };
  try {
    assert.throws(
      () => installClaudePolicy({sourceRoot, claudeHome}),
      /simulated active manifest failure/
    );
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).state, "installing");
  assert.match(fs.readFileSync(policyFile, "utf8"), /leon-engineering:claude-policy:start/);

  installClaudePolicy({sourceRoot, claudeHome});
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome}).valid, true);
});

test("refuses CLAUDE.md and manifest symlink targets", t => {
  const claudeHome = makeClaudeHome(t);
  const claudeTarget = path.join(claudeHome, "user-rules.md");
  const policyFile = path.join(claudeHome, "CLAUDE.md");
  const manifestPath = path.join(claudeHome, MANIFEST);
  fs.writeFileSync(claudeTarget, "private user rules\n");
  fs.symlinkSync(claudeTarget, policyFile);

  assert.throws(
    () => installClaudePolicy({sourceRoot, claudeHome}),
    error => error.code === "invalid_target"
  );
  assert.equal(fs.lstatSync(policyFile).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(claudeTarget, "utf8"), "private user rules\n");
  assert.equal(fs.existsSync(manifestPath), false);

  const manifestHome = makeClaudeHome(t);
  const manifestTarget = path.join(manifestHome, "manifest-target.json");
  const manifestLink = path.join(manifestHome, MANIFEST);
  fs.writeFileSync(manifestTarget, "private manifest\n");
  fs.symlinkSync(manifestTarget, manifestLink);

  for (const operation of [installClaudePolicy, verifyClaudePolicy]) {
    assert.throws(
      () => operation({sourceRoot, claudeHome: manifestHome}),
      error => error.code === "invalid_target"
    );
  }
  assert.equal(fs.lstatSync(manifestLink).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(manifestTarget, "utf8"), "private manifest\n");
});

test("detects manifest placement tampering before rollback can remove user spacing", t => {
  const claudeHome = makeClaudeHome(t);
  const original = "# User rules\n\n";
  const policyFile = path.join(claudeHome, "CLAUDE.md");
  const manifestPath = path.join(claudeHome, MANIFEST);
  fs.writeFileSync(policyFile, original);
  installClaudePolicy({sourceRoot, claudeHome});

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.policy.prefix = "\n\n\n";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome}).valid, false);
  assert.throws(
    () => rollbackClaudePolicy({sourceRoot, claudeHome}),
    /drifted Claude policy/
  );
  assert.match(fs.readFileSync(policyFile, "utf8"), /# User rules\n\n/);
});

test("recovers owned interrupted installing states before installing", t => {
  const completeHome = makeClaudeHome(t);
  installClaudePolicy({sourceRoot, claudeHome: completeHome});
  const completeManifestPath = path.join(completeHome, MANIFEST);
  const completeManifest = JSON.parse(fs.readFileSync(completeManifestPath, "utf8"));
  completeManifest.state = "installing";
  fs.writeFileSync(completeManifestPath, `${JSON.stringify(completeManifest, null, 2)}\n`);

  installClaudePolicy({sourceRoot, claudeHome: completeHome});
  assert.equal(JSON.parse(fs.readFileSync(completeManifestPath, "utf8")).state, "active");
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome: completeHome}).valid, true);

  const missingHome = makeClaudeHome(t);
  const original = "# User rules\n";
  const missingPolicyFile = path.join(missingHome, "CLAUDE.md");
  const missingManifestPath = path.join(missingHome, MANIFEST);
  fs.writeFileSync(missingPolicyFile, original);
  installClaudePolicy({sourceRoot, claudeHome: missingHome});
  const missingManifest = JSON.parse(fs.readFileSync(missingManifestPath, "utf8"));
  missingManifest.state = "installing";
  fs.writeFileSync(missingManifestPath, `${JSON.stringify(missingManifest, null, 2)}\n`);
  fs.writeFileSync(missingPolicyFile, original);

  installClaudePolicy({sourceRoot, claudeHome: missingHome});
  assert.equal(JSON.parse(fs.readFileSync(missingManifestPath, "utf8")).state, "active");
  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome: missingHome}).valid, true);
});

test("reports safe invalid-argument codes through the command line", t => {
  const claudeHome = makeClaudeHome(t);
  const script = path.join(sourceRoot, "scripts", "install-claude-adapter.mjs");
  const invocations = [
    ["--unsupported"],
    ["--install", "--verify", "--claude-home", claudeHome],
    ["--install", "--claude-home"]
  ];

  for (const args of invocations) {
    const result = spawnSync(process.execPath, [script, ...args], {encoding: "utf8"});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /"event":"command_failed"/);
    assert.match(result.stderr, /"code":"invalid_arguments"/);
  }
});
