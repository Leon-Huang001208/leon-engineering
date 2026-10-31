import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {test} from "node:test";
import {installHarnessRuntime} from "../scripts/harness-runtime.mjs";
import {buildHarness, writeHarness} from "../scripts/harness-project.mjs";
import {runObserved, readObservation} from "../scripts/harness-execution.mjs";
import {handleHarnessHook} from "../scripts/harness-hook.mjs";
import {createLifecycle, activateProjectResources, acceptedDeliveryResources} from "../scripts/resource-lifecycle.mjs";

function setup(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "resource-host-"));
  const home = process.env.HOME; process.env.HOME = root;
  t.after(() => { process.env.HOME = home; fs.rmSync(root, {recursive: true, force: true}); });
  const project = path.join(root, "project"); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "AGENTS.md"), "# fixture\n");
  const config = path.join(root, ".agents/leon-engineering/resource-policy.json");
  fs.mkdirSync(path.dirname(config), {recursive: true});
  fs.writeFileSync(config, JSON.stringify({schemaVersion: 1, enabled: true}));
  return {root, project};
}

test("real host hook enrolls and retries debt; successful verifier evidence retires and remains readable", async t => {
  const {project} = setup(t);
  const existingRoot=path.join(project,"existing-project-evidence");fs.mkdirSync(existingRoot);
  createLifecycle().enroll({project,roots:[existingRoot]});
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({scripts: {test: "node verifier.mjs"}}));
  fs.writeFileSync(path.join(project, "verifier.mjs"), "console.log('successful raw evidence')");
  const files = writeHarness({projectRoot: project, harness: buildHarness({projectRoot: project,
    task: {id: "observed", goal: "verify", acceptanceCriteria: ["passed"]}})});
  const manifest = JSON.parse(fs.readFileSync(files.verifiers));
  const v = manifest.verifiers[0]; v.command = `${process.execPath} verifier.mjs`; v.argv = [process.execPath, "verifier.mjs"];
  v.id = `verifier-test-${crypto.createHash("sha256").update(`${v.command}\0.\0package.json`).digest("hex").slice(0, 12)}`;
  fs.writeFileSync(files.verifiers, JSON.stringify(manifest));
  const hook = handleHarnessHook({phase: "pre", input: {cwd: project, session_id: "resource-real-hook", tool_name: "Read"}, runtimeVerifier: () => {}});
  assert.equal(hook.decision, "allow");
  assert.equal(createLifecycle().isEnrolled(project), true);
  const observed = await runObserved({projectRoot: project, taskId: "observed", verifierId: v.id});
  assert.equal(createLifecycle().status().resources.length, 3);
  const receipt = {taskId: "observed", status: "ci_passed", ci: {status: "passed"},
    verification: {status: "passed"}, integrationCommit: "a".repeat(40)};
  const result = acceptedDeliveryResources({projectRoot: project, receipt});
  assert.equal(result.status, "cleaned");
  for (const file of observed.archiveFiles) assert.equal(fs.existsSync(file), false);
  const retired = readObservation({projectRoot: project, taskId: "observed", observationId: observed.observationId});
  assert.equal(retired.originalEvidence, "retired");
  assert.equal(retired.sha256, observed.sha256);
  assert.doesNotMatch(JSON.stringify(retired), /successful raw evidence/);
  assert.throws(() => acceptedDeliveryResources({projectRoot: project, receipt: {...receipt, ci: {status: "pending"}}}), /DELIVERY_UNVERIFIED/);
});

test("installed runtime carries the engine and CLI without developer-relative imports", t => {
  const {root} = setup(t), runtimeRoot = path.join(root, "runtime");
  installHarnessRuntime({sourceRoot: path.resolve("."), runtimeRoot});
  const result = spawnSync(process.execPath, [path.join(runtimeRoot, "resource-lifecycle.mjs"), "preview", "--store", path.join(root, "empty")], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, "preview");
});
