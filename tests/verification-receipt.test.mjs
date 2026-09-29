import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";
import test from "node:test";

import {planGitVerification, planVerification} from "../lib/verification/index.mjs";
import {validateVerificationReceipt} from "../lib/verification/receipt.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "verification");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {encoding: "utf8"}).trim();
}

function write(root, relative, content) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, content);
  return destination;
}

function findValidation(plan, id) {
  return [...plan.tests, ...plan.documentation, ...plan.ci, ...(plan.realMachine ?? [])]
    .find(item => item.id === id);
}

function boundFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-receipt-bound-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test User"]);
  write(
    root,
    ".agents/verification-policy.json",
    fs.readFileSync(path.join(FIXTURES, "rwb-v3", "verification-policy.json"), "utf8"),
  );
  write(root, "src-tauri/tauri.conf.json", "{\"version\":1}\n");
  write(root, "evidence/pass.txt", "verified by fixture runner\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  write(root, "src-tauri/tauri.conf.json", "{\"version\":2}\n");
  const plan = planGitVerification({projectRoot: root, base});
  const common = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  const records = path.join(common, "leon-engineering", "verification");
  fs.mkdirSync(records, {recursive: true});
  const planPath = path.join(records, "plan.json");
  const receiptPath = path.join(records, "receipt.json");
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, {mode: 0o600});
  const receipt = {
    schemaVersion: 2,
    binding: plan.binding,
    changeSummary: plan.changeSummary,
    changedFiles: plan.changedFiles,
    plannedLevel: plan.requiredLevel,
    actualLevel: plan.requiredLevel,
    components: plan.components,
    platforms: plan.platforms,
    impact: plan.impact,
    executed: plan.receiptTemplate.requiredValidationIds.map(id => {
      const validation = findValidation(plan, id);
      return {
        id,
        level: validation.level,
        status: "PASS",
        durationSeconds: 1,
        source: "runner",
        evidence: "evidence/pass.txt",
      };
    }),
    external: plan.receiptTemplate.externalGateIds.map(id => ({
      id,
      status: "PASS",
      source: "ci",
      evidence: "evidence/pass.txt",
    })),
    realMachine: plan.receiptTemplate.releaseGateIds.map(id => ({
      id,
      status: "MANUAL_REQUIRED",
      source: "manual",
      evidence: "evidence/pass.txt",
    })),
    result: "PASS",
    mergeReady: true,
    releaseReady: plan.receiptTemplate.releaseGateIds.length === 0,
    uncoveredRisks: plan.receiptTemplate.releaseGateIds.map(id => `real_machine_manual_required:${id}`),
    escalation: {required: false, targetLevel: null, reasons: []},
  };
  return {root, projectRoot: root, base, plan, planPath, receiptPath, receipt};
}

function saveReceipt(fixture, receipt = fixture.receipt) {
  fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {mode: 0o600});
}

test("valid bound receipt proves local and CI merge gates while preserving manual release state", t => {
  const fixture = boundFixture(t);
  saveReceipt(fixture);
  const result = validateVerificationReceipt(fixture);
  assert.deepEqual(result, {
    schemaVersion: 2,
    valid: true,
    result: "PASS",
    plannedLevel: "L4",
    actualLevel: "L4",
    mergeReady: true,
    releaseReady: false,
    executedCount: fixture.receipt.executed.length,
    externalCount: fixture.receipt.external.length,
    realMachineCount: fixture.receipt.realMachine.length,
    escalationRequired: false,
  });
  const cli = spawnSync(process.execPath, [
    path.join(ROOT, "scripts", "validate-verification-receipt.mjs"),
    "--project", fixture.root,
    "--plan", fixture.planPath,
    "--receipt", fixture.receiptPath,
  ], {encoding: "utf8"});
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).valid, true);
});

test("missing validation and false positive PASS are rejected", t => {
  const fixture = boundFixture(t);
  const missing = structuredClone(fixture.receipt);
  missing.executed.pop();
  saveReceipt(fixture, missing);
  assert.throws(() => validateVerificationReceipt(fixture), /required validation was not executed/);

  const falsePass = structuredClone(fixture.receipt);
  falsePass.external[0].status = "NOT_RUN";
  falsePass.mergeReady = true;
  falsePass.result = "PASS";
  saveReceipt(fixture, falsePass);
  assert.throws(() => validateVerificationReceipt(fixture), /readiness projection|positive receipt/);
});

test("NOT_RUN CI can only produce a blocked merge with an explicit uncovered risk", t => {
  const fixture = boundFixture(t);
  const receipt = structuredClone(fixture.receipt);
  receipt.external[0].status = "NOT_RUN";
  receipt.result = "BLOCKED";
  receipt.mergeReady = false;
  receipt.releaseReady = false;
  receipt.uncoveredRisks.push(`external_gate_not_run:${receipt.external[0].id}`);
  saveReceipt(fixture, receipt);
  const result = validateVerificationReceipt(fixture);
  assert.equal(result.result, "BLOCKED");
  assert.equal(result.mergeReady, false);
});

test("unsafe evidence and symbolic-link plan inputs fail closed", t => {
  const fixture = boundFixture(t);
  const unsafe = structuredClone(fixture.receipt);
  unsafe.executed[0].evidence = "../outside.log";
  saveReceipt(fixture, unsafe);
  assert.throws(() => validateVerificationReceipt(fixture), /repository-relative path/);

  fs.rmSync(fixture.planPath);
  fs.symlinkSync(path.join(fixture.root, "evidence", "pass.txt"), fixture.planPath);
  saveReceipt(fixture);
  assert.throws(() => validateVerificationReceipt(fixture), /symbolic link/);
});

test("code policy framework and plan drift invalidate old evidence", t => {
  const code = boundFixture(t);
  saveReceipt(code);
  write(code.root, "src-tauri/tauri.conf.json", "{\"version\":3}\n");
  assert.throws(() => validateVerificationReceipt(code), /plan does not match|binding/);

  const policy = boundFixture(t);
  saveReceipt(policy);
  const policyValue = JSON.parse(fs.readFileSync(path.join(policy.root, ".agents/verification-policy.json"), "utf8"));
  policyValue.rules[1].reason = "desktop_contract_change";
  write(policy.root, ".agents/verification-policy.json", `${JSON.stringify(policyValue, null, 2)}\n`);
  assert.throws(() => validateVerificationReceipt(policy), /cannot be reproduced|changed set|plan does not match|binding/);

  const framework = boundFixture(t);
  const tamperedPlan = structuredClone(framework.plan);
  tamperedPlan.binding.frameworkSha256 = "0".repeat(64);
  fs.writeFileSync(framework.planPath, `${JSON.stringify(tamperedPlan, null, 2)}\n`, {mode: 0o600});
  saveReceipt(framework, {...framework.receipt, binding: tamperedPlan.binding});
  assert.throws(() => validateVerificationReceipt(framework), /plan does not match|binding/);
});

test("legacy plan v2 and receipt v1 remain valid without Git binding", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-receipt-legacy-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  write(
    root,
    ".agents/verification-policy.json",
    fs.readFileSync(path.join(FIXTURES, "rwb-v2", "verification-policy.json"), "utf8"),
  );
  write(root, "evidence/pass.txt", "legacy evidence\n");
  const plan = planVerification({projectRoot: root, changedFiles: ["app/research_web/main.py"]});
  write(root, "plan.json", `${JSON.stringify(plan, null, 2)}\n`);
  const receipt = {
    schemaVersion: 1,
    changeSummary: plan.changeSummary,
    changedFiles: plan.changedFiles,
    plannedLevel: plan.requiredLevel,
    actualLevel: plan.requiredLevel,
    impact: plan.impact,
    executed: plan.receiptTemplate.requiredValidationIds.map(id => ({
      id,
      level: findValidation(plan, id).level,
      status: "passed",
      durationSeconds: 1,
      evidence: "evidence/pass.txt",
    })),
    external: [],
    result: "passed",
    uncoveredRisks: [],
    escalation: {required: false, targetLevel: null, reasons: []},
  };
  write(root, "receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
  const result = validateVerificationReceipt({projectRoot: root, planPath: "plan.json", receiptPath: "receipt.json"});
  assert.equal(result.valid, true);
  assert.equal(result.result, "passed");
});

test("unbound RWB plan v3 and receipt v2 remain readable as a compatibility envelope", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-receipt-rwb-v3-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  write(
    root,
    ".agents/verification-policy.json",
    fs.readFileSync(path.join(FIXTURES, "rwb-v3", "verification-policy.json"), "utf8"),
  );
  write(root, "evidence/pass.txt", "RWB platform compatibility evidence\n");
  const plan = planVerification({projectRoot: root, changedFiles: ["src-tauri/tauri.conf.json"]});
  write(root, "plan.json", `${JSON.stringify(plan, null, 2)}\n`);
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
    external: plan.receiptTemplate.externalGateIds.map(id => ({id, status: "PASS", evidence: "evidence/pass.txt"})),
    realMachine: plan.receiptTemplate.releaseGateIds.map(id => ({
      id,
      status: "MANUAL_REQUIRED",
      evidence: "evidence/pass.txt",
    })),
    result: "PASS",
    mergeReady: true,
    releaseReady: false,
    uncoveredRisks: plan.receiptTemplate.releaseGateIds.map(id => `real_machine_manual_required:${id}`),
    escalation: {required: false, targetLevel: null, reasons: []},
  };
  write(root, "receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
  const result = validateVerificationReceipt({projectRoot: root, planPath: "plan.json", receiptPath: "receipt.json"});
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.mergeReady, true);
  assert.equal(result.releaseReady, false);
});
