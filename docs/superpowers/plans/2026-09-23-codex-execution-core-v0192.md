# Codex Execution Core 0.19.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship leon-engineering 0.19.2 with migration-aware Codex health verification, worktree-stable Harness state, safe prepared-revision replacement, and a bounded redacted Token audit.

**Architecture:** Add one shared Harness storage resolver below the Git common directory and route every Harness reader/writer through it. Extend existing adapter and delivery state machines without weakening their fail-closed checks. Add a standalone standard-library Token audit and update canonical policy/docs/version metadata only after behavior tests pass.

**Tech Stack:** Node.js ESM and standard library, `node:test`, Git CLI, JSON manifests, Markdown.

**Spec:** `docs/superpowers/specs/2026-09-23-codex-token-efficiency-program-design.md`

## Global Constraints

- No new dependency; Node standard library only.
- Verification is read-only and never repairs.
- Global installation is separately authorized after an exact preview; implementation tests use temporary homes only.
- New Harness directories are mode 0700 and files are mode 0600.
- Never log prompts, message bodies, tool arguments, commands, secrets, account names, or credential values.
- No force-push, forced worktree removal, or silent skip of unreadable records.
- Existing direct-Skill verification remains available only through explicit `--target`.
- Default stdout receipts are at most 4 KiB; explicit wide receipts remain at most 8,000 bytes.

## Review Focus

- A repository whose `.git` is a worktree pointer file must resolve the same Harness root as its main checkout; Task 2 tests both paths.
- A legacy Harness containing a symlink or conflicting task ID must produce a preview finding and refuse migration without partial writes; Task 2 tests both failures.
- A prepared delivery with a pushed branch, recorded CI run, dirty integration tree, or moved remote base must remain unchanged; Task 3 tests each condition.
- A malformed JSONL session must be counted as an error rather than converted to zero usage, while all output remains content-free; Task 4 tests malformed and secret-bearing fixtures.
- Default adapter verification with only one subsystem drift must preserve separate section results and emit one deduplicated overall drift entry; Task 1 tests mixed health.

---

### Task 1: Migration-aware default Codex verification

**Files:**
- Modify: `scripts/install-codex-adapter.mjs`
- Modify: `tests/codex-adapter.test.mjs`
- Modify: `adapters/codex/global-docs/COMMANDS_GUIDE.md`

**Interfaces:**
- Consumes: `verify(targetRoot)`, `verifyPluginDistribution(targetRoot)`, `verifyGlobalFramework(codexHome)`, and `verifyHarnessRuntime(runtimeRoot)`.
- Produces: `verifyCurrentCodexState({sourceRoot, targetRoot, codexHome, runtimeRoot, explicitTarget}) -> {valid, drift, pluginDistribution, globalFramework, runtime}`.

- [ ] **Step 1: Write failing API tests**

Add tests that install a plugin-only fixture plus global framework/runtime, call `verifyCurrentCodexState`, and assert:

```js
assert.deepEqual(result, {
  valid: true,
  drift: [],
  pluginDistribution: {valid: true, drift: []},
  globalFramework: {valid: true, drift: []},
  runtime: {valid: true, drift: []}
});
```

Also remove one Hook file in the fixture and assert only `globalFramework.valid` and overall `valid` become false, with `global:hooks` occurring once.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='migration-aware default verification' tests/codex-adapter.test.mjs`

Expected: FAIL because `verifyCurrentCodexState` is not exported.

- [ ] **Step 3: Implement the composed verifier**

Add a pure exported function that selects plugin distribution when its manifest exists, otherwise selects direct-Skill verification only when `explicitTarget === true`. Prefix drift values with `plugin:`, `global:`, or `runtime:` and deduplicate with `new Set`. Missing manifests become section-level invalid results rather than writes.

- [ ] **Step 4: Write and run the failing CLI routing test**

Spawn `install-codex-adapter.mjs --verify --codex-home <fixture> --runtime-root <fixture>` without `--target`; assert the structured sections exist. Spawn with `--verify --target <fixture>` and assert the legacy `{valid, drift}` contract remains.

Run: `node --test --test-name-pattern='default verify CLI|explicit target verify CLI' tests/codex-adapter.test.mjs`

Expected: first test FAIL before CLI routing changes; explicit target stays GREEN.

- [ ] **Step 5: Route CLI and document the command**

Change `--verify` so absence of `--target` calls `verifyCurrentCodexState`; explicit `--target` calls `verify`. Update `COMMANDS_GUIDE.md` with both forms and state that neither repairs.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/codex-adapter.test.mjs tests/harness-runtime.test.mjs`

Expected: all tests PASS.

Commit: `fix: make Codex verification migration-aware`

---

### Task 2: Worktree-stable Harness storage and migration

**Files:**
- Create: `scripts/harness-storage.mjs`
- Create: `tests/harness-storage.test.mjs`
- Modify: `scripts/harness-project.mjs`
- Modify: `scripts/harness-evaluate.mjs`
- Modify: `scripts/harness-execution.mjs`
- Modify: `scripts/harness-control.mjs`
- Modify: `scripts/harness-runtime.mjs`
- Modify: `tests/harness-project.test.mjs`
- Modify: `tests/harness-session.test.mjs`
- Modify: `tests/harness-evaluate.test.mjs`
- Modify: `tests/harness-execution.test.mjs`
- Modify: `tests/harness-control.test.mjs`
- Modify: `docs/harness-v1.md`
- Modify: `plugins/leon-engineering-core/skills/project-harness/SKILL.md`

**Interfaces:**
- Produces: `resolveHarnessStorage({projectRoot}) -> {projectRoot, repositoryRoot, commonDirectory, directory, legacyDirectory, kind}`.
- Produces: `previewHarnessMigration({projectRoot}) -> {needed, source, destination, files, bytes, conflicts, treeHash}`.
- Produces: `migrateHarnessStorage({projectRoot}) -> {migrated, manifest, rollback}`.
- Consumes: every existing Harness read/write API through an injected or imported resolver.

- [ ] **Step 1: Write failing resolver tests**

Create a Git fixture with a main checkout and linked worktree. Assert both calls return the same directory:

```js
const mainStorage = resolveHarnessStorage({projectRoot: main});
const linkedStorage = resolveHarnessStorage({projectRoot: worktree});
assert.equal(mainStorage.directory, linkedStorage.directory);
assert.equal(mainStorage.directory, path.join(mainStorage.commonDirectory, "leon-engineering", "harness"));
```

Add a non-Git fixture and assert its directory remains `<project>/.ai/harness`.

- [ ] **Step 2: Run resolver tests and observe RED**

Run: `node --test tests/harness-storage.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement read-only resolution**

Use `git -C <root> rev-parse --show-toplevel --git-common-dir`; reject symbolic-link common directories and resolve relative common paths against the repository root. Do not create directories in the resolver. Return `kind: "git-common"` or `kind: "project-local"`.

- [ ] **Step 4: Write failing migration tests**

Cover preview with no writes, successful copy/hash/manifest, unreadable file, symlink, conflicting destination task ID, rollback map, and preservation of the legacy directory. Assert the manifest contains schema version, source/destination, relative file names, per-file SHA-256, aggregate SHA-256, file count, bytes, and `verifiedAt`.

- [ ] **Step 5: Run migration tests and observe RED**

Run: `node --test --test-name-pattern='migration' tests/harness-storage.test.mjs`

Expected: FAIL because preview/migrate functions do not exist.

- [ ] **Step 6: Implement migration without destructive cleanup**

Recursively enumerate only regular files, reject symlinks and unsupported entries, validate every destination is within the resolved common-dir boundary, compare duplicate relative paths byte-for-byte, copy to a private staging directory, hash again, atomically rename staging into place, and write a 0600 manifest plus rollback map. Leave the legacy directory untouched.

- [ ] **Step 7: Route every Harness consumer through the resolver**

Replace direct `.ai/harness` path construction in project, evaluation, execution, and control-plane code with resolved storage paths. Keep generated `projectRoot` metadata as the canonical repository root so all worktrees can read it. Add `harness-storage.mjs` to `HARNESS_RUNTIME_FILES`.

- [ ] **Step 8: Add cross-worktree lifecycle tests**

Start a session from a linked worktree, remove that clean worktree with normal Git, then read the task, record an outcome, evaluate, and enforce from the main checkout. Assert all operations use the same stored record and no reconstruction occurs.

- [ ] **Step 9: Update Skill and docs together**

Document Git-common storage, projectless fallback, preview/apply migration, permissions, and legacy preservation in both `docs/harness-v1.md` and `project-harness/SKILL.md`.

- [ ] **Step 10: Verify and commit**

Run: `node --test tests/harness-storage.test.mjs tests/harness-project.test.mjs tests/harness-session.test.mjs tests/harness-evaluate.test.mjs tests/harness-execution.test.mjs tests/harness-control.test.mjs tests/harness-enforce.test.mjs tests/harness-hook.test.mjs tests/harness-runtime.test.mjs`

Expected: all tests PASS.

Commit: `feat: persist Harness state across worktrees`

---

### Task 3: Safe prepared-revision replacement

**Files:**
- Modify: `scripts/iteration-delivery.mjs`
- Modify: `tests/iteration-delivery.test.mjs`
- Modify: `plugins/leon-engineering-core/skills/iteration-delivery/SKILL.md`
- Modify: `docs/iteration-delivery.md`

**Interfaces:**
- Produces: `prepareDelivery({projectRoot, taskId, integrationWorktreeRoot, replacePrepared = false})`.
- Produces CLI: `--prepare --replace-prepared`.
- Extends `integrationHistory[]` entries with `status: "superseded"` for this transition.

- [ ] **Step 1: Write failing successful-replacement test**

Prepare a delivery, add one new feature commit, call `prepareDelivery(..., replacePrepared: true)`, and assert old integration metadata is in history, old clean worktree is gone, revision suffix increments, remote base is unchanged, and the new receipt is `prepared`.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='replaces an unshipped prepared revision' tests/iteration-delivery.test.mjs`

Expected: FAIL with `delivery is not ready to prepare: prepared`.

- [ ] **Step 3: Write failing refusal tests**

Create subtests for dirty integration worktree, unchanged feature HEAD, moved remote default, prepared commit already in remote default, non-empty `ci.runs`, and receipt PR metadata. Snapshot the receipt and worktree list before each call; assert both remain unchanged after rejection.

- [ ] **Step 4: Implement the guarded transition**

Evaluate every precondition before removing the old worktree or mutating the receipt. Only after all checks pass, append:

```js
{
  branch: receipt.integrationBranch,
  worktree: receipt.integrationWorktree,
  commit: receipt.integrationCommit,
  worktreeRemoved: true,
  status: "superseded"
}
```

Then use normal `git worktree remove` and prepare the next revision.

- [ ] **Step 5: Add CLI flag and docs/Skill update**

Parse `--replace-prepared` only with `--prepare`; reject it for start/publish/status/cleanup. Document exact preconditions and fail-closed behavior.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/iteration-delivery.test.mjs tests/harness-enforce.test.mjs tests/catalog.test.mjs`

Expected: all tests PASS.

Commit: `feat: safely supersede prepared deliveries`

---

### Task 4: Redacted Token audit

**Files:**
- Create: `scripts/token-audit.mjs`
- Create: `tests/token-audit.test.mjs`
- Modify: `docs/2026-09-21-token-harness-v0190.md`
- Modify: `adapters/codex/global-docs/COMMANDS_GUIDE.md`

**Interfaces:**
- Produces: `auditSessionFiles({files}) -> report`.
- Produces: `findThreadSessions({threadId, sessionRoot}) -> absolute JSONL files` without emitting paths.
- CLI accepts either `--session-jsonl <file>` or `--thread-id <id> --session-root <dir>`, plus optional `--output <file>`.

- [ ] **Step 1: Write secret-bearing fixture tests**

Construct JSONL records containing unique canary strings in messages, commands, paths, tool arguments, and tool output. Assert the report includes counts/tokens/bytes/SHA-256 but `JSON.stringify(report)` contains none of the canaries.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `node --test tests/token-audit.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement streaming, redacted aggregation**

Read one line at a time with `readline`; parse known usage and tool-call shapes, hash normalized arguments immediately without retaining raw arguments, classify tool names through a fixed category map, compute p50/p95/max tool-output bytes, and return per-file SHA-256 plus explicit malformed-file errors. Do not include source paths in the report.

- [ ] **Step 4: Add bounded CLI tests**

Assert stdout is `<= 4096` bytes, explicit output is mode 0600, ambiguous/missing selector fails, thread search refuses symlink roots/files, and a malformed file yields a nonzero exit plus a named file ordinal rather than content or path.

- [ ] **Step 5: Implement CLI and docs**

Use atomic 0600 output writes. The CLI prints only compact JSON; the explicit report contains the same redacted schema with full per-file entries.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/token-audit.test.mjs tests/catalog.test.mjs`

Expected: all tests PASS.

Commit: `feat: add redacted Codex token audit`

---

### Task 5: Automatic-continuation policy and 0.19.2 release metadata

**Files:**
- Modify: `adapters/shared/global-policy.md`
- Modify: `adapters/codex/global-docs/COMMANDS_GUIDE.md`
- Modify: `adapters/codex/global-docs/AGENTS_GUIDE.md`
- Modify: `tests/catalog.test.mjs`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/leon-engineering-workflows/.claude-plugin/plugin.json`
- Modify: `plugins/leon-engineering-workflows/.codex-plugin/plugin.json`
- Modify: `docs/pilot-results.md`

**Interfaces:**
- Consumes: behavior from Tasks 1-4.
- Produces: canonical 0.19.2 policy, documentation, manifests, and catalog assertions.

- [ ] **Step 1: Add failing catalog assertions**

Assert canonical policy and docs contain: batched independent reads; structured summaries/counts/hashes/log references; no repeated diagnostics while waiting for authority; one request plus one no-change audit before a real blocked transition; silent unchanged heartbeat; process/session/receipt reuse; 4 KiB and 8,000-byte bounds; and an explicit statement that permissions/tests/gates are not weakened.

- [ ] **Step 2: Run catalog test and observe RED**

Run: `node --test --test-name-pattern='automatic continuation|bounded receipts' tests/catalog.test.mjs`

Expected: FAIL on missing policy language.

- [ ] **Step 3: Update canonical policy and docs**

Add the exact operational rules without adding tool-blocking Hook behavior. Keep policy concise and link detailed command behavior from the guides.

- [ ] **Step 4: Bump all release manifests to 0.19.2**

Update the four version locations in one change. Add a pilot-results entry that distinguishes code verification, installation, restart-required state, and post-restart activation.

- [ ] **Step 5: Run full suite and integrity checks**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS with zero skipped tests.

Run: `git diff --check`

Expected: exit 0.

- [ ] **Step 6: Commit**

Commit: `release: prepare leon-engineering 0.19.2`

---

### Task 6: Managed delivery, authorized installation, and activation receipt

**Files:**
- Modify only if needed after review: files already listed in Tasks 1-5.
- Produce local receipts in Git common-dir delivery/Harness storage; do not commit user paths or secrets.

**Interfaces:**
- Consumes: clean Phase 1 feature branch and the repository's managed `iteration-delivery` workflow.
- Produces: default-branch commit/CI/cleanup receipts, global installation preview, installation verification, and restart-required activation status.

- [ ] **Step 1: Run whole-branch review package**

Build the review package from merge base to HEAD and perform one fresh-context review. Re-grade findings; fix Critical/Important findings with new RED→GREEN tests and a full green suite. Record Minor findings without expanding scope.

- [ ] **Step 2: Run managed delivery preparation**

Start a delivery receipt, prepare an isolated integration worktree, run the full suite there, and record the exact command/duration. If review changes the feature after preparation, exercise `--prepare --replace-prepared` rather than publishing the stale revision.

- [ ] **Step 3: Publish and verify remote CI**

Publish through direct default-branch push or protected-branch PR fallback, wait for the actual CI result, then clean only the verified clean integration worktree/branch and enforce the Harness delivery receipt.

- [ ] **Step 4: Show exact global installation preview**

Run migration-aware `--verify`, runtime/global dry checks, and a file/checksum diff for the managed Hook/runtime/policy outputs. Confirm the diff stays within the already approved `~/.codex` and `~/.agents/leon-engineering/runtime` allowlist.

- [ ] **Step 5: Install and verify after exact-diff authorization**

Run the canonical 0.19.2 global installer, then `--verify`, `--verify-global`, runtime `--verify`, and plugin distribution verification. Record `restart_required`; do not claim behavioral activation yet.

- [ ] **Step 6: Restart and verify activation**

After a full Codex host restart, run a fresh task canary that proves the installed Hook/runtime and Git-common Harness storage are active. Only then mark Phase 1 activated.

- [ ] **Step 7: Final verification**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS with zero skipped tests.

Run: `git status --short --branch`

Expected: the published source checkout is clean and aligned with its remote default branch; only explicitly retained user worktrees remain.
