import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProfile,
  formatMarkdown,
  writeProfile,
  PROFILE_FILENAME
} from "../scripts/profile-project.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

function makeFixture(t, {packageContent} = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-project-profile-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture instructions\n");
  writeFile(path.join(project, "docs", "ARCHITECTURE.md"), "# Fixture architecture\n");
  writeFile(path.join(project, "package.json"), packageContent ?? JSON.stringify({
    scripts: {test: "node --test", lint: "eslint .", build: "vite build"}
  }));
  writeFile(path.join(project, "pyproject.toml"), "[project]\nname = 'fixture'\n");
  fs.mkdirSync(path.join(project, "src-tauri"));
  writeFile(path.join(project, ".github", "workflows", "ci.yml"), "name: CI\n");
  return project;
}

test("builds bounded project evidence without writing", t => {
  const project = makeFixture(t);

  const profile = buildProfile({projectRoot: project});

  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.projectRoot, fs.realpathSync(project));
  assert.deepEqual(profile.instructions, [
    {kind: "agent-instructions", path: "AGENTS.md"},
    {kind: "architecture", path: "docs/ARCHITECTURE.md"}
  ]);
  assert.deepEqual(profile.commands, [
    {kind: "build", verifierId: profile.commands[0].verifierId, command: "npm run build", argv: ["npm", "run", "build"], workingDirectory: ".", source: "package.json", interactive: false, status: "candidate"},
    {kind: "lint", verifierId: profile.commands[1].verifierId, command: "npm run lint", argv: ["npm", "run", "lint"], workingDirectory: ".", source: "package.json", interactive: false, status: "candidate"},
    {kind: "test", verifierId: profile.commands[2].verifierId, command: "npm test", argv: ["npm", "test"], workingDirectory: ".", source: "package.json", interactive: false, status: "candidate"}
  ]);
  for (const command of profile.commands) assert.match(command.verifierId, /^verifier-[a-z]+-[a-f0-9]{12}$/);
  assert.deepEqual(buildProfile({projectRoot: project}).commands, profile.commands);
  assert.deepEqual(profile.ci, [{kind: "workflow", path: ".github/workflows/ci.yml"}]);
  assert.deepEqual(profile.platformSignals, [{kind: "desktop", path: "src-tauri"}]);
  assert.match(formatMarkdown(profile), /Candidate validation commands/);
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);
});

test("persists only the opt-in profile and refuses replacement by default", t => {
  const project = makeFixture(t);
  const profile = buildProfile({projectRoot: project});
  const target = writeProfile({projectRoot: project, profile});

  assert.equal(target, path.join(fs.realpathSync(project), ".ai", PROFILE_FILENAME));
  assert.deepEqual(
    fs.readdirSync(path.join(project, ".ai")),
    [PROFILE_FILENAME]
  );
  assert.throws(
    () => writeProfile({projectRoot: project, profile}),
    /existing project profile/
  );
  assert.equal(writeProfile({projectRoot: project, profile, replace: true}), target);
});

test("rejects unsafe roots and malformed package metadata", t => {
  const project = makeFixture(t, {packageContent: "{not json"});

  assert.throws(() => buildProfile({projectRoot: project}), /invalid package.json/);
  assert.throws(() => buildProfile({projectRoot: os.homedir()}), /unsafe project root/);
  assert.throws(() => buildProfile({projectRoot: path.parse(os.homedir()).root}), /unsafe project root/);
});

test("CLI defaults to read-only JSON and requires an explicit write flag", t => {
  const project = makeFixture(t);
  const script = path.join(sourceRoot, "scripts", "profile-project.mjs");

  const readOnly = spawnSync(
    process.execPath,
    [script, "--project", project, "--format", "json"],
    {encoding: "utf8"}
  );
  assert.equal(readOnly.status, 0, readOnly.stderr);
  assert.equal(JSON.parse(readOnly.stdout).schemaVersion, 1);
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);

  const persisted = spawnSync(
    process.execPath,
    [script, "--project", project, "--write-profile"],
    {encoding: "utf8"}
  );
  assert.equal(persisted.status, 0, persisted.stderr);
  assert.equal(fs.existsSync(path.join(project, ".ai", PROFILE_FILENAME)), true);
});
