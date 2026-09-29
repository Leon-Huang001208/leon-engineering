import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {planVerification as planSharedVerification} from "../lib/verification/index.mjs";
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

function sharedProject(t, fixtureName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `leon-verification-${fixtureName}-`));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, ".agents"), {recursive: true});
  fs.copyFileSync(
    path.join(FIXTURES, fixtureName, "verification-policy.json"),
    path.join(root, ".agents", "verification-policy.json"),
  );
  return root;
}

function writePolicy(projectRoot, policy) {
  fs.writeFileSync(
    path.join(projectRoot, ".agents", "verification-policy.json"),
    `${JSON.stringify(policy, null, 2)}\n`,
  );
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

test("shared planner reproduces the RWB v2 Web envelope", t => {
  const projectRoot = sharedProject(t, "rwb-v2");
  const plan = planSharedVerification({projectRoot, changedFiles: ["app/research_web/main.py"]});
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.risk, "local-only");
  assert.equal(plan.requiredLevel, "L1");
  assert.deepEqual(plan.changeSummary, {fileCount: 1, ruleIds: ["web"], impactIds: ["web"]});
  assert.deepEqual(plan.tests.map(item => item.id), ["web-test"]);
  assert.deepEqual(plan.documentation.map(item => item.id), ["docs-check"]);
  assert.deepEqual(plan.ci, []);
  assert.deepEqual(plan.receiptTemplate, {
    plannedLevel: "L1",
    changedFiles: ["app/research_web/main.py"],
    requiredValidationIds: ["web-test", "docs-check"],
    externalGateIds: [],
  });
});

test("shared planner reproduces the RWB v2 unknown-path envelope", t => {
  const projectRoot = sharedProject(t, "rwb-v2");
  const plan = planSharedVerification({projectRoot, changedFiles: ["future/unknown.py"]});
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.risk, "full-delivery");
  assert.equal(plan.requiredLevel, "L4");
  assert.deepEqual(plan.changeSummary.ruleIds, ["fallback"]);
  assert.deepEqual(plan.uncoveredRisks, ["unknown_impact_boundary"]);
  assert.deepEqual(plan.tests.map(item => item.id), ["full-test"]);
  assert.deepEqual(plan.ci.map(item => item.id), ["project-ci"]);
});

test("shared planner reproduces the RWB v3 desktop platform envelope", t => {
  const projectRoot = sharedProject(t, "rwb-v3");
  const plan = planSharedVerification({projectRoot, changedFiles: ["src-tauri/tauri.conf.json"]});
  assert.equal(plan.schemaVersion, 3);
  assert.equal(plan.risk, "full-delivery");
  assert.equal(plan.requiredLevel, "L4");
  assert.deepEqual(plan.components, ["desktop-platform"]);
  assert.deepEqual(plan.platforms, ["generic", "macos", "windows", "cross-platform", "real-machine-required"]);
  assert.deepEqual(plan.local.map(item => item.id), ["desktop-test", "docs-check"]);
  assert.deepEqual(plan.ci.map(item => item.id), ["macos-ci", "windows-ci"]);
  assert.deepEqual(plan.realMachine.map(item => item.id), ["windows-installation"]);
  assert.deepEqual(plan.receiptTemplate.releaseGateIds, ["windows-installation"]);
});

test("shared planner preserves delegated namespaces and unknown fallback", t => {
  const projectRoot = sharedProject(t, "rwb-v2");
  const policy = readFixture("rwb-v2");
  policy.rules[0].match.excludePrefixes = ["app/research_web/datahub/"];
  policy.rules.push({
    id: "datahub-public",
    risk: "local-only",
    minimumLevel: "L2",
    reason: "datahub_public_change",
    impact: ["datahub-public"],
    coupling: "low",
    match: {
      files: ["app/research_web/datahub/public.py"],
      prefixes: [],
      segments: [],
      suffixes: [],
    },
    tests: ["web-test"],
    documentation: ["docs-check"],
    ci: [],
  });
  writePolicy(projectRoot, policy);

  const known = planSharedVerification({projectRoot, changedFiles: ["app/research_web/datahub/public.py"]});
  assert.deepEqual(known.changeSummary.ruleIds, ["datahub-public"]);
  assert.equal(known.requiredLevel, "L2");

  const unknown = planSharedVerification({projectRoot, changedFiles: ["app/research_web/datahub/private.py"]});
  assert.deepEqual(unknown.changeSummary.ruleIds, ["fallback"]);
  assert.equal(unknown.requiredLevel, "L4");
});

test("shared planner escalates runtime signals without changing platform meaning", t => {
  const projectRoot = sharedProject(t, "rwb-v3");
  const plan = planSharedVerification({
    projectRoot,
    changedFiles: ["app/research_web/main.py"],
    signals: ["validation_failure", "validation_failure"],
  });
  assert.equal(plan.requiredLevel, "L2");
  assert.deepEqual(plan.platforms, ["generic"]);
  assert.deepEqual(plan.escalations, [{
    code: "validation_failure",
    fromLevel: "L1",
    toLevel: "L2",
    impacts: [],
  }]);
});

test("shared planner rejects unsafe paths, unknown references, and invalid platforms", t => {
  const projectRoot = sharedProject(t, "rwb-v3");
  assert.throws(
    () => planSharedVerification({projectRoot, changedFiles: ["../outside.py"]}),
    /repository-relative path/,
  );

  const unknownReference = readFixture("rwb-v3");
  unknownReference.rules[0].tests = ["missing-test"];
  writePolicy(projectRoot, unknownReference);
  assert.throws(
    () => planSharedVerification({projectRoot, changedFiles: ["app/research_web/main.py"]}),
    /unknown rule 0 tests reference/,
  );

  const invalidPlatform = readFixture("rwb-v3");
  invalidPlatform.rules[1].platforms = ["windows", "macos"];
  writePolicy(projectRoot, invalidPlatform);
  assert.throws(
    () => planSharedVerification({projectRoot, changedFiles: ["src-tauri/tauri.conf.json"]}),
    /invalid rule 1 platforms/,
  );
});

test("shared planner rejects a matched rule that cannot form a sufficient validation closure", t => {
  const projectRoot = sharedProject(t, "rwb-v2");
  const policy = readFixture("rwb-v2");
  policy.rules[0].tests = [];
  policy.rules[0].documentation = [];
  policy.rules[0].ci = [];
  writePolicy(projectRoot, policy);
  assert.throws(
    () => planSharedVerification({projectRoot, changedFiles: ["app/research_web/main.py"]}),
    /insufficient verification closure/,
  );
});
