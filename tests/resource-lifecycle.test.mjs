import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {test} from "node:test";
import {createLifecycle, DEFAULT_POLICY, inventoryPaths} from "../lib/resources/lifecycle.mjs";

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "lifecycle-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, "project");
  const artifacts = path.join(root, "artifacts");
  fs.mkdirSync(project); fs.mkdirSync(artifacts);
  const api = createLifecycle({storeRoot: path.join(root, "state"), occupancy: () => "idle", ...options});
  api.enroll({project, roots: [artifacts]});
  const file = (name, data = "disposable") => {
    const target = path.join(artifacts, name); fs.writeFileSync(target, data); return target;
  };
  const register = (name, task = "task-1", kind = "temporary", extra = {}) =>
    api.register({project, task, path: file(name), kind, ...extra});
  const accept = (task = "task-1", extra = {}) => api.event({project, task, type: "delivery-accepted",
    proof: {schemaVersion: 1, task, revision: "a".repeat(40), verification: "passed", source: "test-verifier"}, ...extra});
  return {api, root, project, artifacts, file, register, accept};
}

test("preview is read-only and three accepted iterations reclaim artifacts without backup growth", t => {
  const f = fixture(t);
  for (let i = 1; i <= 3; i++) {
    const task = `task-${i}`;
    const r = f.register(`build-${i}`, task);
    const before = fs.readFileSync(path.join(f.root, "state", "ledger.json"));
    assert.equal(f.api.preview().items[0].reason, "task-active");
    assert.deepEqual(fs.readFileSync(path.join(f.root, "state", "ledger.json")), before);
    const result = f.accept(task);
    assert.equal(result.status, "cleaned");
    assert.equal(fs.existsSync(r.path), false);
    assert.equal(f.api.status().resources.length, 0);
  }
  assert.equal(f.api.status().records.length, 3);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "state")).sort(), ["ledger.json", "logs"]);
});

test("delivery never implies deployment; each target retains current and previous accepted version", t => {
  const f = fixture(t);
  const versions = [];
  for (let i = 1; i <= 3; i++) {
    const task = `release-${i}`, revision = String(i).repeat(40);
    versions.push(f.register(`release-${i}`, task, "deployment", {target: "web", revision}));
    f.accept(task, {proof: {schemaVersion: 1, task, revision, verification: "passed", source: "test-verifier"}});
    assert.equal(fs.existsSync(versions.at(-1).path), true);
    f.api.event({project: f.project, task, type: "deployment-accepted",
      proof: {schemaVersion: 1, task, revision, generation: i, verification: "passed", health: "passed", target: "web", source: "deploy-verifier"}});
  }
  assert.equal(fs.existsSync(versions[0].path), false);
  assert.equal(fs.existsSync(versions[1].path), true);
  assert.equal(fs.existsSync(versions[2].path), true);
});

test("shared references prevent removal until every owning task releases the resource", t => {
  const f = fixture(t), second = path.join(f.root, "second"); fs.mkdirSync(second);
  f.api.enroll({project: second, roots: [f.artifacts]});
  const r = f.register("shared");
  f.api.register({project: second, task: "task-b", path: r.path, kind: "temporary"});
  f.accept(); assert.equal(fs.existsSync(r.path), true);
  f.api.event({project: second, task: "task-b", type: "task-retired",
    proof: {schemaVersion: 1, task: "task-b", disposition: "cancelled", uniqueWorkPreserved: true, source: "operator"}});
  assert.equal(fs.existsSync(r.path), false);
});

test("failure and interruption are not retirement, and unbound acceptance proofs are rejected", t => {
  const f = fixture(t), r = f.register("failed");
  assert.throws(() => f.accept("task-1", {proof: {verification: "passed"}}), /PROOF_INVALID/);
  assert.throws(() => f.api.event({project: f.project, task: "task-1", type: "task-failed"}), /EVENT_INVALID/);
  assert.equal(fs.existsSync(r.path), true);
  assert.throws(() => f.api.event({project: f.project, task: "task-1", type: "task-retired",
    proof: {schemaVersion: 1, task: "task-1", disposition: "cancelled", source: "operator"}}), /PROOF_INVALID/);
});

test("occupied resources become debt, unchanged debt is quiet, resume repays it", t => {
  let occupancy = "busy";
  const f = fixture(t, {occupancy: () => occupancy});
  const r = f.register("occupied");
  assert.equal(f.accept().status, "blocked");
  assert.equal(f.api.resumeOnce({project: f.project, task: "task-1"}).notify, false);
  occupancy = "idle";
  const result = f.api.resumeOnce({project: f.project, task: "task-1"});
  assert.equal(result.notify, true); assert.equal(result.status, "cleaned");
  assert.equal(fs.existsSync(r.path), false);
});

test("identity changes, nested roots, symlinks, Git and protected categories cannot be deleted", t => {
  const f = fixture(t), r = f.register("changed");
  fs.writeFileSync(r.path, "changed contents");
  assert.equal(f.accept().items[0].reason, "IDENTITY_CHANGED");
  assert.throws(() => f.api.register({project: f.project, task: "t", path: f.artifacts, kind: "temporary"}), /ROOT_RESOURCE_FORBIDDEN/);
  fs.symlinkSync(r.path, path.join(f.artifacts, "link"));
  assert.throws(() => f.api.register({project: f.project, task: "t", path: path.join(f.artifacts, "link"), kind: "temporary"}), /SYMLINK/);
  assert.throws(() => f.register("business", "t", "business-data"), /KIND_INVALID/);
  const repo = path.join(f.artifacts, "repo"); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, ".git"));
  assert.throws(() => f.api.register({project: f.project, task: "t", path: repo, kind: "temporary"}), /GIT_RESOURCE_FORBIDDEN/);
});

test("cache budget is host-wide, deduplicated, LRU and protects leased caches", t => {
  const f = fixture(t, {policy: {cacheBudgetBytes: 10}});
  const a = f.register("a", "old", "cache");
  const b = f.register("b", "new", "cache");
  f.accept("old");
  assert.equal(fs.existsSync(a.path), false); assert.equal(fs.existsSync(b.path), true);
  assert.equal(f.api.status().cacheBytes, 10);
  assert.equal(DEFAULT_POLICY.cacheBudgetBytes, 20 * 1024 ** 3);
});

test("locks block concurrent writes, and interrupted deletion is resumed without another backup", t => {
  let interrupt = true;
  const f = fixture(t, {afterQuarantine: () => { if (interrupt) throw new Error("interrupted"); }});
  const r = f.register("crash");
  assert.equal(f.accept().status, "blocked");
  assert.equal(fs.existsSync(r.path), false);
  assert.equal(f.api.status().resources[0].state, "reclaiming");
  fs.writeFileSync(path.join(f.root, "state", ".lock"), "other owner");
  assert.throws(() => f.api.event({project: f.project, task: "task-1", type: "resume"}), /STORE_LOCKED/);
  fs.unlinkSync(path.join(f.root, "state", ".lock")); interrupt = false;
  assert.equal(f.api.event({project: f.project, task: "task-1", type: "resume"}).status, "cleaned");
  assert.equal(fs.readdirSync(f.artifacts).length, 0);
});

test("minimal record rotation is bounded but unresolved and rollback records stay protected", t => {
  const f = fixture(t, {policy: {recordLimit: 2, recordBudgetBytes: 4096}});
  for (let i = 0; i < 5; i++) { f.register(`b${i}`, `t${i}`); f.accept(`t${i}`); }
  assert.equal(f.api.status().records.length, 2);
  assert.equal(f.api.status().tasks.length, 2);
});

test("native occupancy detects a real open file on macOS", {skip: process.platform !== "darwin"}, t => {
  const f = fixture(t), r = f.register("native");
  const native = createLifecycle({storeRoot: path.join(f.root, "state")});
  const fd = fs.openSync(r.path, "r");
  t.after(() => fs.closeSync(fd));
  const result = native.event({project: f.project, task: "task-1", type: "delivery-accepted",
    proof: {schemaVersion: 1, task: "task-1", revision: "a".repeat(40), verification: "passed", source: "native-test"}});
  assert.equal(result.status, "blocked"); assert.equal(result.items[0].reason, "RESOURCE_BUSY");
});

test("CLI preview on a missing store creates no files and rejects arbitrary command options", t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "lifecycle-cli-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const cli = path.resolve("scripts/resource-lifecycle.mjs"), store = path.join(root, "missing");
  const result = spawnSync(process.execPath, [cli, "preview", "--store", store], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr); assert.equal(fs.existsSync(store), false);
  const invalid = spawnSync(process.execPath, [cli, "event", "--store", store, "--command", "rm -rf /"], {encoding: "utf8"});
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /CLI_OPTION_INVALID/);
});

test("retired evidence remains inspectable through an integrity-checked minimal summary", t => {
  const f = fixture(t);
  const evidence = {observationId: "observation-" + "a".repeat(24), verifierId: "verifier-test-" + "b".repeat(12),
    status: "passed", sha256: "c".repeat(64), fullBytes: 10, durationMs: 1};
  const r = f.register("stdout", "task-1", "evidence", {evidence});
  f.accept();
  assert.equal(fs.existsSync(r.path), false);
  assert.deepEqual(f.api.retiredEvidence({project: f.project, task: "task-1", observationId: evidence.observationId}).evidence, evidence);
});

test("old deployment event replay cannot rotate out a newer accepted version", t => {
  const f = fixture(t);
  const proofs = [];
  for (let i = 1; i <= 3; i++) {
    const task = `release-${i}`, revision = String(i).repeat(40);
    f.register(`deploy-${i}`, task, "deployment", {target: "web", revision});
    const proof = {schemaVersion: 1, task, revision, verification: "passed", source: "test"};
    f.accept(task, {proof}); proofs.push({...proof, generation: i, target: "web", health: "passed"});
    f.api.event({project: f.project, task, type: "deployment-accepted", proof: proofs.at(-1)});
  }
  assert.throws(() => f.api.event({project: f.project, task: "release-1", type: "deployment-accepted", proof: proofs[0]}), /DEPLOYMENT_EVENT_STALE/);
  assert.deepEqual(f.api.status().projects[f.project].deployments.web.map(v => v.task), ["release-3", "release-2"]);
  assert.throws(() => f.accept("release-3"), /REVISION_CONFLICT/);
});

test("tool-managed caches contribute to the same host budget without filesystem deletion", t => {
  const f = fixture(t, {policy: {cacheBudgetBytes: 15}});
  const r = f.register("cache", "task-1", "cache");
  f.api.reportCache({project: f.project, adapter: "buildkit", bytes: 12, receiptSha256: "d".repeat(64)});
  const result = f.accept();
  assert.equal(fs.existsSync(r.path), false); assert.equal(result.cacheBytes, 12);
  f.api.reportCache({project: f.project, adapter: "buildkit", bytes: 16, receiptSha256: "e".repeat(64)});
  assert.equal(f.api.event({project: f.project, task: "task-1", type: "resume"}).status, "blocked");
});

test("inventory only measures and labels unknown history, without registering or deleting it", t => {
  const f = fixture(t); const file = f.file("legacy", "unknown history");
  const before = fs.readFileSync(path.join(f.root, "state/ledger.json"));
  const report = inventoryPaths({paths: [file], state: f.api.status()});
  assert.equal(report.items[0].ownership, "unknown");
  assert.equal(report.items[0].action, "review-required");
  assert.equal(report.items[0].logicalBytes, 15);
  assert.deepEqual(fs.readFileSync(path.join(f.root, "state/ledger.json")), before);
  assert.equal(fs.existsSync(file), true);
});

test("SIGKILL releases ownership on the next event without removing a live or unknown lock", t => {
  const f = fixture(t), r = f.register("killed");
  const script = `import {createLifecycle} from ${JSON.stringify(new URL('../lib/resources/lifecycle.mjs', import.meta.url).href)};
    const api=createLifecycle({storeRoot:process.argv[1],occupancy:()=>"idle",afterQuarantine:()=>process.kill(process.pid,"SIGKILL")});
    api.event({project:process.argv[2],task:"task-1",type:"delivery-accepted",proof:{schemaVersion:1,task:"task-1",revision:"a".repeat(40),verification:"passed",source:"test"}});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, path.join(f.root, "state"), f.project]);
  assert.equal(child.signal, "SIGKILL");
  assert.equal(fs.existsSync(r.path), false);
  assert.equal(f.api.event({project: f.project, task: "task-1", type: "resume"}).status, "cleaned");
});

test("reusing a shared cache does not protect every historical task record forever", t => {
  const f = fixture(t, {policy: {recordLimit: 2}});
  const file = f.file("reused-cache");
  for (let i=0; i<6; i++) {
    f.api.register({project: f.project, task: `task-${i}`, path: file, kind: "cache"});
    f.accept(`task-${i}`);
  }
  assert.equal(f.api.status().records.length, 2);
  assert.equal(f.api.status().resources[0].owners.length, 1);
});

test("deployment replay remains stale after task summaries have rotated away", t => {
  const f=fixture(t,{policy:{recordLimit:2}}),proofs=[];
  for(let i=1;i<=4;i++){
    const task=`deploy-${i}`,revision=String(i).repeat(40);
    f.register(task,task,"deployment",{target:"web",revision});
    const proof={schemaVersion:1,task,revision,source:"test",verification:"passed"};
    f.accept(task,{proof});proofs.push({...proof,target:"web",generation:i,health:"passed"});
    f.api.event({project:f.project,task,type:"deployment-accepted",proof:proofs.at(-1)});
  }
  f.accept("deploy-1",{proof:{schemaVersion:1,task:"deploy-1",revision:"1".repeat(40),source:"test",verification:"passed"}});
  assert.throws(()=>f.api.event({project:f.project,task:"deploy-1",type:"deployment-accepted",proof:proofs[0]}),/DEPLOYMENT_EVENT_STALE/);
  assert.deepEqual(f.api.status().projects[f.project].deployments.web.map(v=>v.task),["deploy-4","deploy-3"]);
});

test("empty lock left during release is recoverable without accepting unknown lock contents", t => {
  const f=fixture(t);f.register("empty-lock");
  fs.mkdirSync(path.join(f.root,"state/.lock"));
  assert.equal(f.accept().status,"cleaned");
});

test("a completed mutation remains successful when another owner takes the released lock", t => {
  const f=fixture(t);f.register("handoff");
  const original=fs.rmdirSync,lock=path.join(f.root,"state/.lock");let replaced=false;
  fs.rmdirSync=function(directory,...args){
    if(directory===lock&&!replaced){
      replaced=true;original(directory);fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory,"other-owner"),"live owner");
    }
    return original(directory,...args);
  };
  try{assert.equal(f.accept().status,"cleaned");assert.equal(replaced,true);}
  finally{fs.rmdirSync=original;}
  assert.equal(fs.readFileSync(path.join(lock,"other-owner"),"utf8"),"live owner");
});
