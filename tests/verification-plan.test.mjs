import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {buildVerificationPlan} from "../scripts/verification-plan.mjs";

function makeFixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-verification-plan-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  fs.mkdirSync(path.join(project, ".agents"), {recursive: true});
  fs.writeFileSync(path.join(project, ".agents", "verification-policy.json"), `${JSON.stringify({
    schemaVersion: 1,
    verifiers: {
      "service-test": {kind: "test", argv: ["python", "-m", "pytest", "tests/test_service.py", "-q"], cwd: "."},
      "service-lint": {kind: "lint", argv: ["ruff", "check"], cwd: ".", appendChangedFiles: true, extensions: [".py"]},
      "api-contract": {kind: "test", argv: ["python", "-m", "pytest", "tests/test_api.py", "-q"], cwd: "."},
      "desktop-contract": {kind: "test", argv: ["python", "-m", "pytest", "tests/test_desktop.py", "-q"], cwd: "."}
    },
    rules: [
      {name: "service", prefixes: ["services/"], tests: ["service-test"], lints: ["service-lint"], documentation: ["task-report"], gates: ["harness-task"]},
      {name: "api", prefixes: ["app/api/"], minimumTier: "isolated", tests: ["api-contract"], documentation: ["api-doc"], ci: ["web-ci"], gates: ["public-contract"]},
      {name: "desktop", prefixes: ["desktop/"], minimumTier: "full-delivery", tests: ["desktop-contract"], ci: ["desktop-native-ci"], gates: ["desktop-native"]},
      {name: "docs", prefixes: ["docs/", ".ai/reports/"], tests: [], lints: [], documentation: ["doc-sync"], gates: ["documentation"]}
    ]
  }, null, 2)}\n`);
  return project;
}

test("plans only direct tests and changed-file lint for a mapped internal fix", t => {
  const project = makeFixture(t);
  const result = buildVerificationPlan({
    projectRoot: project,
    riskTier: "local-only",
    changeKind: "internal",
    changedFiles: ["services/example.py"]
  });
  assert.equal(result.effectiveRiskTier, "local-only");
  assert.deepEqual(result.testClosure.map(item => item.id), ["service-test"]);
  assert.deepEqual(result.lintClosure[0].argv, ["ruff", "check", "services/example.py"]);
  assert.deepEqual(result.documentationClosure, ["task-report"]);
  assert.deepEqual(result.ciClosure, []);
  assert.deepEqual(result.unmappedPaths, []);
});

test("contract and desktop changes upgrade risk without adding unrelated platform gates", t => {
  const project = makeFixture(t);
  const api = buildVerificationPlan({projectRoot: project, riskTier: "local-only", changeKind: "contract", changedFiles: ["app/api/routes.py"]});
  assert.equal(api.effectiveRiskTier, "full-delivery");
  assert.deepEqual(api.testClosure.map(item => item.id), ["api-contract"]);
  assert.deepEqual(api.ciClosure, ["web-ci"]);
  assert.doesNotMatch(JSON.stringify(api), /desktop-native/);
  assert.match(api.escalationReason.join(" "), /contract/);

  const desktop = buildVerificationPlan({projectRoot: project, riskTier: "local-only", changeKind: "internal", changedFiles: ["desktop/window.ts"]});
  assert.equal(desktop.effectiveRiskTier, "full-delivery");
  assert.deepEqual(desktop.ciClosure, ["desktop-native-ci"]);
  assert.ok(desktop.requiredGates.includes("desktop-native"));
});

test("unknown paths fail closed into full delivery", t => {
  const project = makeFixture(t);
  const result = buildVerificationPlan({projectRoot: project, riskTier: "local-only", changeKind: "internal", changedFiles: ["shared/unknown.py"]});
  assert.equal(result.effectiveRiskTier, "full-delivery");
  assert.deepEqual(result.unmappedPaths, ["shared/unknown.py"]);
  assert.match(result.escalationReason.join(" "), /unmapped/);
});

test("CLI emits the same compact plan and never runs verifier commands", t => {
  const project = makeFixture(t);
  const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "scripts", "verification-plan.mjs");
  const result = spawnSync(process.execPath, [
    script, "--project", project, "--risk-tier", "local-only", "--change-kind", "internal", "--changed-file", "services/example.py"
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.deepEqual(body.testClosure.map(item => item.id), ["service-test"]);
  assert.equal(fs.existsSync(path.join(project, "this-command-must-not-run")), false);
});
