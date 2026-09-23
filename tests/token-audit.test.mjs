import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {auditSessionFiles, findThreadSessions} from "../scripts/token-audit.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leon-token-audit-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
  return file;
}

function secretFixture(file, threadId = "thread-safe-01") {
  const canaries = {
    message: "PRIVATE_MESSAGE_CANARY_8472",
    command: "PRIVATE_COMMAND_CANARY_9183",
    path: "/private/PATH_CANARY_1029",
    output: "PRIVATE_OUTPUT_CANARY_7654",
    argument: "PRIVATE_ARGUMENT_CANARY_3344"
  };
  const records = [
    {type: "session_meta", payload: {id: "session-01", thread_id: threadId, cwd: canaries.path}},
    {type: "turn_context", payload: {turn_id: "turn-01", summary: canaries.message}},
    {type: "token_usage_record", payload: {thread_id: threadId, turn_id: "turn-01", usage: {
      input_tokens: 100, cached_input_tokens: 80, cache_write_input_tokens: 0,
      output_tokens: 10, reasoning_output_tokens: 4, total_tokens: 110
    }}},
    {type: "token_usage_record", payload: {thread_id: threadId, turn_id: "turn-01", usage: {
      input_tokens: 50, cached_input_tokens: 20, cache_write_input_tokens: 0,
      output_tokens: 5, reasoning_output_tokens: 2, total_tokens: 55
    }}},
    {type: "response_item", payload: {type: "custom_tool_call", name: "functions.exec", input: JSON.stringify({cmd: canaries.command, value: canaries.argument})}},
    {type: "response_item", payload: {type: "custom_tool_call", name: "functions.exec", input: JSON.stringify({value: canaries.argument, cmd: canaries.command})}},
    {type: "response_item", payload: {type: "custom_tool_call_output", output: canaries.output}}
  ];
  writeJsonl(file, records);
  return canaries;
}

test("audits usage and repeated tools without disclosing session content", async t => {
  const root = makeRoot(t);
  const file = path.join(root, "session.jsonl");
  const canaries = secretFixture(file);

  const report = await auditSessionFiles({files: [file]});

  assert.equal(report.complete, true);
  assert.equal(report.counts.sessions, 1);
  assert.equal(report.counts.turns, 1);
  assert.equal(report.counts.modelCalls, 2);
  assert.equal(report.counts.toolCalls, 2);
  assert.deepEqual(report.tokens, {
    input: 150,
    cachedInput: 100,
    nonCachedInput: 50,
    output: 15,
    reasoning: 6,
    total: 165
  });
  assert.equal(report.toolOutput.count, 1);
  assert.equal(report.toolOutput.maxBytes, Buffer.byteLength(canaries.output));
  assert.equal(report.repeatedCalls.length, 1);
  assert.equal(report.repeatedCalls[0].count, 2);
  assert.match(report.repeatedCalls[0].fingerprint, /^[0-9a-f]{64}$/);
  assert.match(report.files[0].sha256, /^[0-9a-f]{64}$/);
  const rendered = JSON.stringify(report);
  for (const canary of Object.values(canaries)) assert.doesNotMatch(rendered, new RegExp(canary));
});

test("finds thread sessions without following symbolic links", async t => {
  const root = makeRoot(t);
  const session = path.join(root, "2026", "09", "session.jsonl");
  secretFixture(session, "thread-find-01");

  assert.deepEqual(await findThreadSessions({threadId: "thread-find-01", sessionRoot: root}), [fs.realpathSync(session)]);

  const linkedFile = path.join(root, "linked.jsonl");
  fs.symlinkSync(session, linkedFile);
  await assert.rejects(
    () => findThreadSessions({threadId: "thread-find-01", sessionRoot: root}),
    /symbolic link/
  );
  fs.rmSync(linkedFile);
  const linkedRoot = path.join(path.dirname(root), `${path.basename(root)}-link`);
  fs.symlinkSync(root, linkedRoot);
  t.after(() => fs.rmSync(linkedRoot, {force: true}));
  await assert.rejects(
    () => findThreadSessions({threadId: "thread-find-01", sessionRoot: linkedRoot}),
    /symbolic link/
  );
});

test("CLI emits bounded redacted output and writes a private complete report", t => {
  const root = makeRoot(t);
  const sessionRoot = path.join(root, "sessions");
  const canaries = [];
  for (let index = 0; index < 120; index += 1) {
    const file = path.join(sessionRoot, String(index), "session.jsonl");
    canaries.push(...Object.values(secretFixture(file, "thread-many-01")));
  }
  const output = path.join(root, "complete-report.json");
  const script = path.join(sourceRoot, "scripts", "token-audit.mjs");

  const result = spawnSync(process.execPath, [
    script, "--thread-id", "thread-many-01", "--session-root", sessionRoot, "--output", output
  ], {encoding: "utf8"});

  assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) <= 4096);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  const complete = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(complete.files.length, 120);
  assert.equal(complete.complete, true);
  const visible = `${result.stdout}\n${result.stderr}\n${JSON.stringify(complete)}`;
  for (const canary of canaries.slice(0, 5)) assert.doesNotMatch(visible, new RegExp(canary));
});

test("CLI rejects ambiguous selectors and identifies malformed input only by ordinal", t => {
  const root = makeRoot(t);
  const file = path.join(root, "malformed-private-name.jsonl");
  secretFixture(file, "thread-malformed-01");
  fs.appendFileSync(file, "MALFORMED_PRIVATE_CANARY\n");
  const script = path.join(sourceRoot, "scripts", "token-audit.mjs");

  const missing = spawnSync(process.execPath, [script], {encoding: "utf8"});
  assert.equal(missing.status, 1);
  const ambiguous = spawnSync(process.execPath, [
    script, "--session-jsonl", file, "--thread-id", "thread-malformed-01", "--session-root", root
  ], {encoding: "utf8"});
  assert.equal(ambiguous.status, 1);
  const malformed = spawnSync(process.execPath, [script, "--session-jsonl", file], {encoding: "utf8"});
  assert.equal(malformed.status, 2);
  const report = JSON.parse(malformed.stdout);
  assert.equal(report.complete, false);
  assert.deepEqual(report.errors, [{fileOrdinal: 1, code: "malformed_jsonl", line: 8}]);
  assert.doesNotMatch(`${malformed.stdout}${malformed.stderr}`, /malformed-private-name|MALFORMED_PRIVATE_CANARY/);
});
