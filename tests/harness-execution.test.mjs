import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {buildHarness, writeHarness} from "../scripts/harness-project.mjs";
import {readObservation, runObserved} from "../scripts/harness-execution.mjs";

function writeFile(file, content, options) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content, options);
}

function makeExecutionFixture(t, source) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-execution-"));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  writeFile(path.join(project, "AGENTS.md"), "# Fixture\n");
  writeFile(path.join(project, "package.json"), JSON.stringify({scripts: {test: "node verifier.mjs"}}));
  writeFile(path.join(project, "verifier.mjs"), source);
  const harness = buildHarness({
    projectRoot: project,
    task: {id: "observed-task", goal: "run verifier", acceptanceCriteria: ["result archived"]}
  });
  const files = writeHarness({projectRoot: project, harness});
  const verifierManifest = JSON.parse(fs.readFileSync(files.verifiers, "utf8"));
  const command = `${process.execPath} verifier.mjs`;
  verifierManifest.verifiers[0].command = command;
  verifierManifest.verifiers[0].argv = [process.execPath, "verifier.mjs"];
  verifierManifest.verifiers[0].id = `verifier-test-${crypto.createHash("sha256")
    .update(`${command}\0.\0package.json`).digest("hex").slice(0, 12)}`;
  fs.writeFileSync(files.verifiers, `${JSON.stringify(verifierManifest, null, 2)}\n`, {mode: 0o600});
  return {project, files, verifierId: verifierManifest.verifiers[0].id};
}

test("runs only a registered non-interactive verifier and archives both streams with mode 0600", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('ok\\n'); process.stderr.write('note\\n');\n");

  const result = await runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: fixture.verifierId
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.verifierId, fixture.verifierId);
  assert.equal(result.status, "passed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.output.encoding, "utf8");
  assert.match(result.output.stdout, /ok\n$/);
  assert.equal(result.output.stderr, "note\n");
  assert.equal(result.truncated, false);
  assert.match(result.observationId, /^observation-[a-f0-9]{24}$/);
  for (const file of result.archiveFiles) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test("records a verifier failure without converting it into an execution-layer exception", async t => {
  const fixture = makeExecutionFixture(t, "process.stderr.write('failed\\n'); process.exitCode = 7;\n");

  const result = await runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: fixture.verifierId
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.equal(result.output.stderr, "failed\n");
});

test("rejects an unregistered verifier id before any command can run", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('registered only\\n');\n");

  await assert.rejects(() => runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: "verifier-test-000000000000"
  }), /unknown verifier/);

  assert.equal(fs.existsSync(path.join(fixture.project, ".ai", "harness", "logs")), false);
});

test("preserves split UTF-8 and CRLF exactly and recalls the same observation", async t => {
  const fixture = makeExecutionFixture(t, [
    "const bytes = Buffer.from('你\\r\\n');",
    "process.stdout.write(bytes.subarray(0, 1));",
    "setTimeout(() => process.stdout.write(bytes.subarray(1)), 10);"
  ].join("\n"));
  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId});

  assert.deepEqual(result.output, {encoding: "utf8", stdout: "你\r\n", stderr: ""});
  assert.equal(result.sha256, crypto.createHash("sha256").update(Buffer.from("你\r\n")).digest("hex"));

  const recalled = readObservation({
    projectRoot: fixture.project,
    taskId: "observed-task",
    observationId: result.observationId
  });
  assert.deepEqual(recalled.output, result.output);
  assert.equal(recalled.sha256, result.sha256);
  assert.equal(recalled.recallCount, 1);
  assert.throws(() => readObservation({
    projectRoot: fixture.project,
    taskId: "observed-task",
    observationId: "observation-000000000000000000000000"
  }), /missing observation/);
});

test("returns small binary output losslessly as base64", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write(Buffer.from([0, 255, 1, 2]));\n");

  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId});

  assert.deepEqual(result.output, {encoding: "base64", stdout: "AP8BAg==", stderr: ""});
  assert.equal(result.fullBytes, 4);
  assert.equal(result.truncated, false);
});

test("returns an exactly 8KiB binary stream completely only with an explicit wide receipt", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write(Buffer.alloc(8 * 1024, 255));\n");

  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId, wideReceipt: true});

  assert.equal(result.output.encoding, "base64");
  assert.equal(Buffer.from(result.output.stdout, "base64").length, 8 * 1024);
  assert.equal(result.fullBytes, 8 * 1024);
  assert.equal(result.truncated, false);
});

test("archives a 1MiB stream and returns a deduplicated receipt no larger than 4KiB", async t => {
  const fixture = makeExecutionFixture(t, [
    "const output = Buffer.alloc(1024 * 1024, 65);",
    "Buffer.from('HEAD\\n').copy(output, 0);",
    "Buffer.from('\\nERROR_CONTEXT_UNIQUE\\n').copy(output, 512 * 1024);",
    "Buffer.from('\\nTAIL\\n').copy(output, output.length - 6);",
    "process.stdout.write(output);"
  ].join("\n"));

  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId});

  assert.equal(result.fullBytes, 1024 * 1024);
  assert.equal(result.truncated, true);
  assert.equal(result.output.encoding, "receipt");
  assert.ok(Buffer.byteLength(result.output.text) <= 4 * 1024);
  assert.match(result.output.text, /HARNESS_OBSERVATION v1/);
  assert.match(result.output.text, new RegExp(result.observationId));
  assert.match(result.output.text, /status=passed/);
  assert.match(result.output.text, new RegExp(`returned_bytes=${result.returnedBytes}(?:\\n|$)`));
  assert.match(result.output.text, /HEAD/);
  assert.match(result.output.text, /TAIL/);
  assert.match(result.output.text, /ERROR_CONTEXT_UNIQUE/);
  assert.equal(result.output.text.match(/ERROR_CONTEXT_UNIQUE/g)?.length, 1);
  const stdoutFile = result.archiveFiles.find(file => file.endsWith(".stdout.bin"));
  assert.equal(fs.statSync(stdoutFile).size, 1024 * 1024);
  assert.equal(result.sha256, crypto.createHash("sha256").update(fs.readFileSync(stdoutFile)).digest("hex"));
});

test("never returns a suspected secret from execution or recall while retaining the local original", async t => {
  const secret = "PRIVATE_SENTINEL_42";
  const fixture = makeExecutionFixture(t, `process.stdout.write('api_key=${secret}\\n');\n`);

  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId});
  assert.equal(result.secretSuppressed, true);
  assert.equal(result.output.encoding, "receipt");
  assert.doesNotMatch(JSON.stringify(result.output), new RegExp(secret));
  const stdoutFile = result.archiveFiles.find(file => file.endsWith(".stdout.bin"));
  assert.match(fs.readFileSync(stdoutFile, "utf8"), new RegExp(secret));

  const recalled = readObservation({projectRoot: fixture.project, taskId: "observed-task", observationId: result.observationId});
  assert.equal(recalled.secretSuppressed, true);
  assert.doesNotMatch(JSON.stringify(recalled), new RegExp(secret));
});

test("rejects tampered observation metadata before recall", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('safe\\n');\n");
  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId});
  const metadataFile = result.archiveFiles.find(file => file.endsWith(".json"));
  const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  metadata.verifierId = "api_key=PRIVATE_METADATA_SENTINEL";
  fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

  assert.throws(() => readObservation({
    projectRoot: fixture.project,
    taskId: "observed-task",
    observationId: result.observationId
  }), /invalid observation/);
});

test("distinguishes timeout signal and caller cancellation", async t => {
  const timed = makeExecutionFixture(t, "setInterval(() => {}, 1000);\n");
  const timeout = await runObserved({
    projectRoot: timed.project,
    taskId: "observed-task",
    verifierId: timed.verifierId,
    timeoutMs: 25
  });
  assert.equal(timeout.status, "timed_out");
  assert.equal(timeout.exitCode, null);
  assert.equal(timeout.signal, "SIGTERM");

  const signaled = makeExecutionFixture(t, "process.kill(process.pid, 'SIGTERM');\n");
  const signal = await runObserved({projectRoot: signaled.project, taskId: "observed-task", verifierId: signaled.verifierId});
  assert.equal(signal.status, "signaled");
  assert.equal(signal.exitCode, null);
  assert.equal(signal.signal, "SIGTERM");

  const cancelled = makeExecutionFixture(t, "setInterval(() => {}, 1000);\n");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 25);
  const cancellation = await runObserved({
    projectRoot: cancelled.project,
    taskId: "observed-task",
    verifierId: cancelled.verifierId,
    signal: controller.signal
  });
  assert.equal(cancellation.status, "cancelled");
  assert.equal(cancellation.signal, "SIGTERM");
});

test("falls back to a persistent local archive when the primary archive fails", async t => {
  const secret = "FALLBACK_PRIVATE_SENTINEL";
  const fixture = makeExecutionFixture(t, `process.stdout.write('password=${secret}\\n');\n`);

  const result = await runObserved(
    {projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId},
    {archiveWriter: () => { throw new Error("simulated primary archive failure"); }}
  );
  t.after(() => fs.rmSync(path.dirname(path.dirname(result.archiveFiles[0])), {recursive: true, force: true}));

  assert.equal(result.archiveFailed, true);
  assert.equal(result.archiveLocation, "fallback");
  assert.ok(result.archiveFiles.every(file => fs.existsSync(file)));
  assert.match(fs.readFileSync(result.archiveFiles.find(file => file.endsWith(".stdout.bin")), "utf8"), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result.output), new RegExp(secret));
  const recalled = readObservation({projectRoot: fixture.project, taskId: "observed-task", observationId: result.observationId});
  assert.equal(recalled.archiveLocation, "fallback");
  assert.doesNotMatch(JSON.stringify(recalled.output), new RegExp(secret));
});

test("refuses traversal and symbolic-link observation paths", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('safe\\n');\n");
  await assert.rejects(() => runObserved({
    projectRoot: fixture.project,
    taskId: "../outside",
    verifierId: fixture.verifierId
  }), /invalid task id/);

  const manifest = JSON.parse(fs.readFileSync(fixture.files.verifiers, "utf8"));
  manifest.verifiers[0].workingDirectory = "../outside";
  manifest.verifiers[0].id = `verifier-test-${crypto.createHash("sha256")
    .update(`${manifest.verifiers[0].command}\0../outside\0package.json`).digest("hex").slice(0, 12)}`;
  fs.writeFileSync(fixture.files.verifiers, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(() => runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: manifest.verifiers[0].id
  }), /(?:invalid verifier manifest|unsafe verifier working directory)/);

  manifest.verifiers[0].workingDirectory = ".";
  manifest.verifiers[0].id = fixture.verifierId;
  fs.writeFileSync(fixture.files.verifiers, `${JSON.stringify(manifest, null, 2)}\n`);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "leon-harness-external-logs-"));
  t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  fs.symlinkSync(external, path.join(fixture.project, ".ai", "harness", "logs"));
  await assert.rejects(() => runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: fixture.verifierId
  }), /invalid observation directory/);
  assert.deepEqual(fs.readdirSync(external), []);
});

test("rejects a verifier whose stable id command and argv disagree", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('safe\\n');\n");
  const manifest = JSON.parse(fs.readFileSync(fixture.files.verifiers, "utf8"));
  manifest.verifiers[0].argv = [process.execPath, "-e", "process.exit(0)"];
  fs.writeFileSync(fixture.files.verifiers, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(() => runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: fixture.verifierId
  }), /invalid verifier manifest/);
  assert.equal(fs.existsSync(path.join(fixture.project, ".ai", "harness", "logs")), false);
});

test("archives a registered verifier start failure as evidence", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('unused\\n');\n");
  const manifest = JSON.parse(fs.readFileSync(fixture.files.verifiers, "utf8"));
  const command = "leon-command-that-does-not-exist";
  manifest.verifiers[0].command = command;
  manifest.verifiers[0].argv = [command];
  manifest.verifiers[0].id = `verifier-test-${crypto.createHash("sha256")
    .update(`${command}\0.\0package.json`).digest("hex").slice(0, 12)}`;
  fs.writeFileSync(fixture.files.verifiers, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = await runObserved({
    projectRoot: fixture.project,
    taskId: "observed-task",
    verifierId: manifest.verifiers[0].id
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, null);
  assert.match(result.output.stderr, /registered verifier could not start/);
  assert.ok(result.archiveFiles.every(file => fs.existsSync(file)));
});

test("records observation metrics without commands log references hashes or output", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('metric-safe\\n');\n");
  const result = await runObserved({projectRoot: fixture.project, taskId: "observed-task", verifierId: fixture.verifierId});
  readObservation({projectRoot: fixture.project, taskId: "observed-task", observationId: result.observationId});

  const metrics = fs.readFileSync(fixture.files.metrics, "utf8").trim().split("\n").map(JSON.parse);
  const recorded = metrics.find(event => event.event === "observation_recorded");
  const recalled = metrics.find(event => event.event === "observation_recalled");
  assert.deepEqual(Object.keys(recorded).sort(), [
    "archiveFailed", "durationMs", "event", "fullBytes", "returnedBytes", "status", "taskId", "timestamp", "truncated", "verifierId"
  ]);
  assert.deepEqual(Object.keys(recalled).sort(), [
    "archiveFailed", "durationMs", "event", "fullBytes", "recallCount", "returnedBytes", "status", "taskId", "timestamp", "truncated", "verifierId"
  ]);
  assert.equal(recalled.recallCount, 1);
  assert.doesNotMatch(JSON.stringify([recorded, recalled]), /command|logRef|sha256|metric-safe/);
});

test("thin CLI runs and recalls by id without accepting arbitrary commands", async t => {
  const fixture = makeExecutionFixture(t, "process.stdout.write('cli-ok\\n');\n");
  const cli = path.resolve(import.meta.dirname, "..", "scripts", "harness-run.mjs");
  const executed = spawnSync(process.execPath, [
    cli,
    "--project", fixture.project,
    "--task-id", "observed-task",
    "--verifier-id", fixture.verifierId
  ], {encoding: "utf8"});
  assert.equal(executed.status, 0, executed.stderr);
  const result = JSON.parse(executed.stdout);
  assert.equal(result.status, "passed");
  assert.equal(result.output.stdout, "cli-ok\n");

  const recalled = spawnSync(process.execPath, [
    cli,
    "--project", fixture.project,
    "--task-id", "observed-task",
    "--read-observation", result.observationId
  ], {encoding: "utf8"});
  assert.equal(recalled.status, 0, recalled.stderr);
  assert.equal(JSON.parse(recalled.stdout).observationId, result.observationId);

  const marker = path.join(fixture.project, "must-not-exist");
  const arbitrary = spawnSync(process.execPath, [
    cli,
    "--project", fixture.project,
    "--task-id", "observed-task",
    "--command", `${process.execPath} -e \"require('fs').writeFileSync('${marker}', 'bad')\"`
  ], {encoding: "utf8"});
  assert.notEqual(arbitrary.status, 0);
  assert.match(arbitrary.stderr, /unknown option/);
  assert.equal(fs.existsSync(marker), false);
});
