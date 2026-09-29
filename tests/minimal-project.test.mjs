import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import test from "node:test";

import {applyProjectRuntime, verifyProjectRuntime} from "../lib/project/managed-runtime.mjs";
import {planVerification, validateVerificationReceipt} from "../lib/verification/index.mjs";
import {buildProfile} from "../scripts/profile-project.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "minimal-project");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8"}).trim();
}

function copyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-minimal-project-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.cpSync(FIXTURE, root, {recursive: true});
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

function findValidation(plan, id) {
  return [...plan.tests, ...plan.documentation, ...plan.ci, ...plan.realMachine].find(item => item.id === id);
}

test("minimal project is discovered and routes local versus unknown changes through configuration", t => {
  const projectRoot = copyFixture(t);
  const profile = buildProfile({projectRoot});
  assert.ok(profile.instructions.some(item => item.path === "AGENTS.md"));
  const local = planVerification({projectRoot, changedFiles: ["src/example.mjs"]});
  assert.equal(local.risk, "local-only");
  assert.equal(local.requiredLevel, "L1");
  assert.deepEqual(local.tests.map(item => item.id), ["example-test"]);
  const unknown = planVerification({projectRoot, changedFiles: ["future/unknown.mjs"]});
  assert.equal(unknown.risk, "full-delivery");
  assert.equal(unknown.requiredLevel, "L4");
});

test("minimal project validates a complete receipt without RWB assumptions", t => {
  const projectRoot = copyFixture(t);
  fs.mkdirSync(path.join(projectRoot, "evidence"), {recursive: true});
  fs.writeFileSync(path.join(projectRoot, "evidence", "pass.txt"), "pass\n");
  const plan = planVerification({projectRoot, changedFiles: ["src/example.mjs"]});
  fs.writeFileSync(path.join(projectRoot, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const receipt = {
    schemaVersion: 2,
    changeSummary: plan.changeSummary,
    changedFiles: plan.changedFiles,
    plannedLevel: plan.requiredLevel,
    actualLevel: plan.requiredLevel,
    components: plan.components,
    platforms: plan.platforms,
    impact: plan.impact,
    executed: plan.receiptTemplate.requiredValidationIds.map(id => ({
      id,
      level: findValidation(plan, id).level,
      status: "PASS",
      durationSeconds: 1,
      evidence: "evidence/pass.txt",
    })),
    external: [],
    realMachine: [],
    result: "PASS",
    mergeReady: true,
    releaseReady: true,
    uncoveredRisks: [],
    escalation: {required: false, targetLevel: null, reasons: []},
  };
  fs.writeFileSync(path.join(projectRoot, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal(validateVerificationReceipt({
    projectRoot,
    planPath: "plan.json",
    receiptPath: "receipt.json",
  }).valid, true);
});

test("minimal project runtime records framework identity and detects drift", t => {
  const projectRoot = copyFixture(t);
  const applied = applyProjectRuntime({sourceRoot: ROOT, projectRoot});
  assert.match(applied.manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(applied.manifest.frameworkVersion, "0.19.3");
  assert.equal(verifyProjectRuntime({sourceRoot: ROOT, projectRoot}).valid, true);
  fs.appendFileSync(
    path.join(projectRoot, ".agents", "runtime", "leon-engineering", "lib", "verification", "index.mjs"),
    "// drift\n",
  );
  assert.equal(verifyProjectRuntime({sourceRoot: ROOT, projectRoot}).valid, false);
});

test("minimal fixture contains no ResearchWorkbench business coupling", () => {
  const text = fs.readdirSync(FIXTURE, {recursive: true})
    .filter(relative => fs.statSync(path.join(FIXTURE, relative)).isFile())
    .map(relative => fs.readFileSync(path.join(FIXTURE, relative), "utf8"))
    .join("\n");
  assert.doesNotMatch(text, /research[_-]?web|ResearchWorkbench|\b8088\b|\b3081\b|\bWind\b|\bTauri\b/i);
});
