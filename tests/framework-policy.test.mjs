import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {planVerification} from "../lib/verification/index.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("documentation-only framework changes stay at L0 without remote gates", () => {
  const plan = planVerification({projectRoot: ROOT, changedFiles: ["docs/README.md"]});
  assert.equal(plan.risk, "docs-only");
  assert.equal(plan.requiredLevel, "L0");
  assert.deepEqual(plan.ci, []);
  assert.deepEqual(plan.documentation.map(item => item.id), ["architecture-map"]);
});

test("verification policy schema and engine changes are fixed L4 contracts", () => {
  for (const file of [
    ".agents/verification-policy.json",
    "lib/verification/planner.mjs",
    "schemas/verification-plan-v3.schema.json",
    "scripts/validate-verification-receipt.mjs",
  ]) {
    const plan = planVerification({projectRoot: ROOT, changedFiles: [file]});
    assert.equal(plan.risk, "full-delivery", file);
    assert.equal(plan.requiredLevel, "L4", file);
    assert.ok(plan.tests.some(item => item.id === "verification-fixed-contracts"), file);
    assert.ok(plan.ci.some(item => item.id === "framework-ci"), file);
  }
});

test("runtime adapter Hook and CI boundaries fail closed at L4", () => {
  for (const file of [
    "lib/project/managed-runtime.mjs",
    "scripts/harness-runtime.mjs",
    "adapters/codex/hooks.json",
    "hooks/hooks.json",
    ".github/workflows/framework-checks.yml",
  ]) {
    const plan = planVerification({projectRoot: ROOT, changedFiles: [file]});
    assert.equal(plan.requiredLevel, "L4", file);
    assert.equal(plan.risk, "full-delivery", file);
  }
});

test("governance internals remain focused while mixed changes take the highest requirement", () => {
  const governance = planVerification({projectRoot: ROOT, changedFiles: ["lib/governance/architecture-map.mjs"]});
  assert.equal(governance.risk, "local-only");
  assert.equal(governance.requiredLevel, "L1");
  assert.deepEqual(governance.tests.map(item => item.id), ["architecture-map-contracts"]);

  const mixed = planVerification({
    projectRoot: ROOT,
    changedFiles: ["lib/governance/architecture-map.mjs", "lib/project/managed-runtime.mjs"],
  });
  assert.equal(mixed.risk, "full-delivery");
  assert.equal(mixed.requiredLevel, "L4");
});

test("unknown framework paths keep full-delivery L4 fallback", () => {
  const plan = planVerification({projectRoot: ROOT, changedFiles: ["future/new-boundary.mjs"]});
  assert.equal(plan.risk, "full-delivery");
  assert.equal(plan.requiredLevel, "L4");
  assert.deepEqual(plan.changeSummary.ruleIds, ["fallback"]);
  assert.deepEqual(plan.uncoveredRisks, ["unknown_impact_boundary"]);
});
