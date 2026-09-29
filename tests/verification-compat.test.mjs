import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {buildVerificationPlan} from "../scripts/verification-plan.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "verification");

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "verification-policy.json"), "utf8"));
}

function legacyProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-verification-v1-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, ".agents"), {recursive: true});
  fs.copyFileSync(
    path.join(FIXTURES, "leon-v1", "verification-policy.json"),
    path.join(root, ".agents", "verification-policy.json"),
  );
  return root;
}

test("leon v1 mapped internal change preserves the exact public plan envelope", t => {
  const projectRoot = legacyProject(t);
  const plan = buildVerificationPlan({
    projectRoot,
    riskTier: "local-only",
    changeKind: "internal",
    changedFiles: ["services/example.mjs"],
  });
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.requestedRiskTier, "local-only");
  assert.equal(plan.effectiveRiskTier, "local-only");
  assert.deepEqual(plan.changedFiles, ["services/example.mjs"]);
  assert.deepEqual(plan.testClosure.map(item => item.id), ["service-test"]);
  assert.deepEqual(plan.lintClosure[0].argv, ["node", "scripts/lint.mjs", "services/example.mjs"]);
  assert.deepEqual(plan.requiredGates, ["harness-task"]);
  assert.deepEqual(plan.unmappedPaths, []);
});

test("leon v1 unknown paths retain full-delivery fail-closed behavior", t => {
  const projectRoot = legacyProject(t);
  const plan = buildVerificationPlan({
    projectRoot,
    riskTier: "local-only",
    changeKind: "internal",
    changedFiles: ["future/unknown.mjs"],
  });
  assert.equal(plan.effectiveRiskTier, "full-delivery");
  assert.deepEqual(plan.unmappedPaths, ["future/unknown.mjs"]);
  assert.deepEqual(plan.requiredGates, ["delivery-receipt"]);
  assert.deepEqual(plan.escalationReason, ["unmapped-paths"]);
});

test("RWB v2 fixture freezes Web-local and unknown-L4 compatibility semantics", () => {
  const policy = readFixture("rwb-v2");
  assert.equal(policy.schemaVersion, 2);
  assert.deepEqual(policy.riskOrder, ["docs-only", "local-only", "full-delivery"]);
  assert.deepEqual(policy.levelOrder, ["L0", "L1", "L2", "L3", "L4"]);
  const web = policy.rules.find(rule => rule.id === "web");
  assert.deepEqual({risk: web.risk, level: web.minimumLevel, tests: web.tests, ci: web.ci}, {
    risk: "local-only",
    level: "L1",
    tests: ["web-test"],
    ci: [],
  });
  assert.deepEqual({
    risk: policy.fallback.risk,
    level: policy.fallback.minimumLevel,
    reason: policy.fallback.reason,
    impact: policy.fallback.impact,
  }, {
    risk: "full-delivery",
    level: "L4",
    reason: "unknown_path",
    impact: ["unknown-boundary"],
  });
});

test("RWB v3 fixture freezes platform lanes and merge versus release gates", () => {
  const policy = readFixture("rwb-v3");
  assert.equal(policy.schemaVersion, 3);
  assert.deepEqual(policy.statusOrder, [
    "PASS", "FAIL", "SKIPPED", "NOT_REQUIRED", "NOT_RUN", "BLOCKED", "MANUAL_REQUIRED",
  ]);
  const web = policy.rules.find(rule => rule.id === "web");
  const desktop = policy.rules.find(rule => rule.id === "desktop");
  assert.deepEqual(web.platforms, ["generic"]);
  assert.deepEqual(desktop.platforms, ["macos", "windows", "cross-platform", "real-machine-required"]);
  assert.deepEqual(desktop.ci, ["macos-ci", "windows-ci"]);
  assert.deepEqual(desktop.realMachine, ["windows-installation"]);
  assert.equal(policy.catalogs.ci["windows-ci"].lane, "ci");
  assert.equal(policy.catalogs.ci["windows-ci"].gate, "merge");
  assert.equal(policy.catalogs.realMachine["windows-installation"].lane, "real-machine");
  assert.equal(policy.catalogs.realMachine["windows-installation"].gate, "release");
});
