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

  assert.equal(verifyClaudePolicy({sourceRoot, claudeHome}).valid, false);
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
