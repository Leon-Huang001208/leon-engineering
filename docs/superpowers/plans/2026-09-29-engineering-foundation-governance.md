# Engineering Foundation Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not delegate shared verification-kernel edits; the current implementation route is inline and serial.

**Goal:** Turn leon-engineering into the single versioned, testable, distributable engineering foundation and connect current ResearchWorkbench to its shared verification kernel without changing product behavior.

**Architecture:** Extract strict verification and governance logic into `lib/`, retain scripts as compatibility CLIs, add versioned schemas and a manifest-owned project runtime, then make leon and RWB consume the shared kernel through project-owned policies. Keep architecture inventory, verification routing, Harness evidence, and host adapters as separate authorities.

**Tech Stack:** Node.js ESM and standard library, `node:test`, strict JSON protocols, Git worktrees, existing Harness/runtime/adapter infrastructure, GitHub Actions YAML checked locally.

**Spec:** `docs/superpowers/specs/2026-09-29-engineering-foundation-governance-design.md`

---

## Global boundaries

- Start from `fcc04b583f047dc01a0a02d233521ed2709364b5` in `codex/engineering-foundation-governance`.
- Do not modify files currently dirty in `codex/harness-v2-ledger`: `scripts/harness-project.mjs`, `scripts/harness-evaluate.mjs`, `scripts/harness-hook.mjs`, `scripts/install-codex-adapter.mjs`, related Hook JSON, or their tests.
- Preserve `leon-engineering`, `leon-engineering-workflows`, and `leon-engineering-commands` IDs and existing public script/CLI/export contracts.
- No dependencies, global install, host restart, push, PR, tag, release, workflow dispatch, or GitHub settings mutation.
- Use `apply_patch` for repository edits. Run tests before recording Harness outcomes. Commit only verified slices.

## Task 1: Commit the migration baseline

**Files:**

- Create: `docs/2026-09-29-engineering-foundation-governance-audit.md`
- Create: `docs/superpowers/specs/2026-09-29-engineering-foundation-governance-design.md`
- Create: `docs/superpowers/plans/2026-09-29-engineering-foundation-governance.md`
- Modify: `docs/README.md`

- [ ] Add a `Current foundation governance` section to `docs/README.md` linking the three documents and label older dated documents as historical design/evidence.
- [ ] Run `git diff --check` and verify the three new paths are the only diff outside `docs/README.md`.
- [ ] Commit `docs: baseline engineering foundation governance`.

## Task 2: Establish root entrypoints and an architecture map

**Files:**

- Create: `README.md`
- Create: `AGENTS.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/DEVELOPMENT_MAP.md`
- Create: `docs/architecture-map.json`
- Create: `lib/governance/architecture-map.mjs`
- Create: `scripts/check-architecture-map.mjs`
- Create: `tests/architecture-map.test.mjs`
- Modify: `docs/README.md`

**Interfaces:**

```js
export function validateArchitectureMap({projectRoot, mapPath = "docs/architecture-map.json"})
// -> {schemaVersion: 1, valid: true, moduleCount, referencedPathCount}
```

- [ ] Write failing tests for missing entrypoints, duplicate module IDs, duplicate authoritative source ownership, missing docs/tests, symlinks, path traversal, unknown top-level tracked directories, and the rule that architecture coverage never claims test execution.
- [ ] Run `node --test tests/architecture-map.test.mjs`; expect failures because the map/checker do not exist.
- [ ] Implement a standard-library validator in `lib/governance/architecture-map.mjs`; make `scripts/check-architecture-map.mjs` only parse `--project`, call the library, emit JSON, and map typed errors to exit 1.
- [ ] Populate the map with existing Harness, verification, project discovery, constraints, delivery, Token audit, Skill governance, adapters, plugins, Hooks, agents, docs, and tests.
- [ ] Write current-product README/AGENTS/architecture/development-map content and classify handbook, decisions, plans, snapshots, generated files, and archive in `docs/README.md`.
- [ ] Run `node --test tests/architecture-map.test.mjs tests/catalog.test.mjs` and `git diff --check`.
- [ ] Commit `docs: establish foundation entrypoints and architecture map`.

## Task 3: Freeze all existing verification contracts

**Files:**

- Create: `tests/fixtures/verification/leon-v1/verification-policy.json`
- Create: `tests/fixtures/verification/rwb-v2/verification-policy.json`
- Create: `tests/fixtures/verification/rwb-v3/verification-policy.json`
- Create: `tests/verification-compat.test.mjs`
- Modify: `tests/verification-plan.test.mjs`

**Compatibility cases:**

```text
leon v1 mapped internal -> exact v1 plan shape and legacy CLI flags
leon v1 unknown path   -> full-delivery + unmapped-paths
RWB v2 Web path        -> local-only / L1 / zero desktop gates
RWB v2 unknown path    -> full-delivery / L4 / unknown_impact_boundary
RWB v3 desktop path    -> macOS + Windows CI merge gates + real-machine release gate
```

- [ ] Copy only schema/route fixtures needed for tests; remove all RWB business commands not required by a representative contract.
- [ ] Add tests that import existing public functions and spawn existing CLI paths. Assert stable JSON error codes/exit behavior where already public.
- [ ] Run `node --test tests/verification-plan.test.mjs tests/verification-compat.test.mjs`; all freeze tests must pass before extraction.
- [ ] Commit `test: freeze verification compatibility contracts`.

## Task 4: Extract policy, path-safety, and planning core

**Files:**

- Create: `lib/verification/errors.mjs`
- Create: `lib/verification/path-safety.mjs`
- Create: `lib/verification/policy.mjs`
- Create: `lib/verification/planner.mjs`
- Create: `lib/verification/index.mjs`
- Create: `schemas/verification-policy-v3.schema.json`
- Create: `schemas/verification-plan-v3.schema.json`
- Modify: `scripts/verification-plan.mjs`
- Modify: `tests/verification-compat.test.mjs`
- Modify: `tests/verification-plan.test.mjs`

**Interfaces:**

```js
export class VerificationError extends Error { constructor(code, message) }
export function loadVerificationPolicy({projectRoot, policyPath})
export function planVerification({projectRoot, policy, changedFiles, signals, binding})
export function buildLegacyVerificationPlan({projectRoot, riskTier, changeKind, changedFiles})
```

- [ ] Add RED tests for strict v2/v3 keys, delegated namespaces, separate risk/level/platform/lane/gate fields, missing references, unsafe paths, and empty sufficient-closure rejection.
- [ ] Run the two focused suites and capture the intended RED failures.
- [ ] Move deterministic logic from the leon v1 and RWB v2/v3 planners into the library. Normalize internally; emit the exact requested compatibility envelope.
- [ ] Keep catalog values inert. New v3 argv entries are data only; the planner contains no child-process import.
- [ ] Replace `scripts/verification-plan.mjs` internals with a thin compatibility adapter while retaining `buildVerificationPlan` and legacy CLI help.
- [ ] Run focused tests, `tests/catalog.test.mjs`, and `git diff --check`.
- [ ] Commit `refactor: extract shared verification planner`.

## Task 5: Discover and bind the complete Git changed set

**Files:**

- Create: `lib/verification/changed-files.mjs`
- Create: `tests/verification-change-set.test.mjs`
- Modify: `lib/verification/planner.mjs`
- Modify: `lib/verification/index.mjs`
- Modify: `scripts/verification-plan.mjs`
- Modify: `schemas/verification-plan-v3.schema.json`

**Interfaces:**

```js
export function discoverGitChangeSet({projectRoot, base})
// -> {baseCommit, headCommit, entries:[{path,status,origin,previousPath?}], digest}
export function assertCompleteChangedSet({discovered, explicitPaths})
```

- [ ] Create temporary Git repositories in tests covering committed, staged, unstaged, untracked, deleted, renamed, spaces, Chinese names, ignored files, and an invalid baseline.
- [ ] Assert rename source and destination are both routed and explicit subsets fail with `INCOMPLETE_CHANGE_SET`.
- [ ] Run the focused test and capture RED.
- [ ] Implement Git reads through `execFileSync`/`spawnSync` argv only: name-status `-z` diffs plus `ls-files --others --exclude-standard -z`. Never invoke a shell.
- [ ] Add canonical CLI `--base <commit>` mode. Preserve legacy repeated `--changed-file` mode; when both are present require exact completeness.
- [ ] Bind base/head/change digest, policy digest, framework version/commit, and plan digest into v3 plans.
- [ ] Run change-set, compatibility, and planner suites.
- [ ] Commit `feat: bind verification plans to complete changes`.

## Task 6: Extract receipt validation and freshness checks

**Files:**

- Create: `lib/verification/receipt.mjs`
- Create: `scripts/validate-verification-receipt.mjs`
- Create: `schemas/verification-receipt-v2.schema.json`
- Create: `tests/verification-receipt.test.mjs`
- Modify: `lib/verification/index.mjs`
- Modify: `tests/verification-compat.test.mjs`

**Interfaces:**

```js
export function validateVerificationReceipt({projectRoot, planPath, receiptPath, policyPath})
// -> {schemaVersion: 2, valid: true, result, mergeReady, releaseReady, executedCount}
```

- [ ] Port the RWB receipt-v1 and platform-branch receipt-v2 contract cases as RED tests against the leon library.
- [ ] Add stale base/head, changed-set digest, policy digest, framework digest, plan digest, missing item, false PASS, `NOT_REQUIRED`, missing CI, missing real-machine evidence, unsafe evidence path, and command-nonexecution cases.
- [ ] Implement strict legacy plan-v2/receipt-v1 read validation and canonical plan-v3/receipt-v2 validation. Replan against current policy and reject any mismatch.
- [ ] Require `source: runner|ci|manual` on new evidence and a regular repository-relative evidence file. Do not treat JSON creation as execution.
- [ ] Run receipt, planner, compatibility, and path-safety suites.
- [ ] Commit `feat: validate bound verification receipts`.

## Task 7: Add manifest-owned project runtime distribution

**Files:**

- Create: `lib/project/managed-runtime.mjs`
- Create: `scripts/project-runtime.mjs`
- Create: `schemas/project-runtime-manifest-v1.schema.json`
- Create: `templates/project/scripts/plan_verification.mjs`
- Create: `templates/project/scripts/validate_verification_receipt.mjs`
- Create: `tests/project-runtime.test.mjs`
- Modify: `scripts/harness-runtime.mjs`
- Modify: `tests/harness-runtime.test.mjs`
- Modify: `docs/DEVELOPMENT_MAP.md`

**Interfaces:**

```js
export function previewProjectRuntime({sourceRoot, projectRoot})
export function applyProjectRuntime({sourceRoot, projectRoot})
export function verifyProjectRuntime({sourceRoot, projectRoot})
export function rollbackProjectRuntime({projectRoot, receiptPath})
```

- [ ] Write RED tests for clean install, idempotent verify, upgrade from an old manifest, user policy/wrapper preservation, managed-file drift rejection, foreign collision, symlink, stale source, injected partial failure, private backup, rollback, and new relative files in Harness runtime distribution.
- [ ] Implement full-batch preflight, staging, SHA-256 readback, atomic promotion, Git-common private backup/receipt, and collision-safe rollback.
- [ ] Extend `HARNESS_RUNTIME_FILES` without changing old destination names; support relative `lib/`, `schemas/`, and template resources in new manifests while reading schema-v1 flat manifests.
- [ ] Run runtime, adapter, catalog, and project-runtime suites in temporary homes only.
- [ ] Commit `feat: distribute managed project verification runtime`.

## Task 8: Make leon use its own maps, constraints, and planner

**Files:**

- Create: `.agents/project-constraints.json`
- Create: `.agents/verification-policy.json`
- Create: `.github/workflows/framework-checks.yml`
- Create: `tests/framework-policy.test.mjs`
- Create: `tests/framework-ci.test.mjs`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_MAP.md`
- Modify: `docs/architecture-map.json`

- [ ] Add RED tests proving docs-only routing, focused library routing, mixed-module escalation, unknown fail-closed, and unconditional L4 routing for verification/policy/schema/runtime/adapter/Hook/CI/release changes.
- [ ] Add project constraints for required entrypoints, map/doc synchronization, plugin manifest consistency, and the existing no-recursive-agent boundary.
- [ ] Add a lightweight workflow running Node tests, architecture-map/constraints checks, and `git diff --check`; add contract tests for triggers and commands.
- [ ] Run the new fixed tests directly, then use the new planner against its own changed set. The fixed tests, not the generated plan, are the independent trust anchor.
- [ ] Commit `ci: make leon-engineering self-verifying`.

## Task 9: Add a non-RWB reusable fixture

**Files:**

- Create: `tests/fixtures/minimal-project/.agents/verification-policy.json`
- Create: `tests/fixtures/minimal-project/src/example.mjs`
- Create: `tests/fixtures/minimal-project/tests/example.test.mjs`
- Create: `tests/minimal-project.test.mjs`
- Modify: `docs/DEVELOPMENT_MAP.md`

- [ ] Add cases for project identification, local focused validation, unknown-path L4 escalation, receipt completeness, runtime version tracking, and upgrade drift.
- [ ] Assert no fixture path or policy contains `research_web`, RWB ports, vendor integrations, desktop paths, or RWB test names.
- [ ] Run the fixture and project-runtime suites.
- [ ] Commit `test: prove project-neutral verification reuse`.

## Task 10: Integrate current RWB in a separate worktree

**RWB files allowed:**

- `.agents/verification-policy.json`
- `.agents/runtime/leon-engineering/**`
- `.agents/skills/incremental-validation/SKILL.md`
- `.agents/skills/incremental-validation/README.md`
- `scripts/plan_verification.mjs`
- `scripts/validate_verification_receipt.mjs`
- `tests/javascript/verification_policy.test.mjs`
- `tests/javascript/verification_receipt.test.mjs`
- `tests/javascript/incremental_validation_skill.test.mjs`
- `docs/AGENT_WORKFLOW.md`
- `docs/DEVELOPMENT_MAP.md`
- `docs/README.md`
- one dated `.ai/reports/` integration report

- [ ] Create a new RWB worktree from the live remote `master`; do not use the dirty Desktop checkout or merge the platform branch.
- [ ] Start a separate RWB Harness task and record the exact base commit, current untracked exclusions, framework version/commit, and platform-branch reference commits.
- [ ] Use leon `project-runtime.mjs` preview/apply to install only the managed verification runtime. Verify the manifest before editing wrappers.
- [ ] Replace RWB planner/receipt internals with thin wrappers while preserving their paths, exports, CLI flags, stable errors, and legacy read behavior.
- [ ] Adapt the already-tested schema-v3/receipt-v2 project policy semantics from the platform branch, excluding `service_manager.py`, workflow, launcher, and other product changes.
- [ ] Run the RWB 85-test master baseline, the platform representative A-H contracts through the shared kernel, documentation governance, architecture checks, Python index check, and project constraints appropriate to the changed files.
- [ ] Commit RWB slices locally. Do not push, dispatch CI, merge, or claim Windows/real-machine evidence.

## Task 11: Full local verification, review, and Harness closeout

**Files:**

- Modify only files required by validated review findings and synchronized documentation.

- [ ] Run `node --test tests/*.test.mjs` in leon and record exact totals/duration.
- [ ] Run `node scripts/check-architecture-map.mjs --project .`, project constraints for the complete changed set, the canonical verification planner with the branch base, `git diff --check`, JSON parse checks, and plugin/catalog tests.
- [ ] Test clean install, upgrade, idempotence, drift rejection, injected failure, rollback, and manifest file coverage in temporary directories.
- [ ] Perform a diff review for public interfaces, error paths, command execution safety, symlink/path traversal, distribution completeness, and concurrent-worktree overlap.
- [ ] Re-run affected suites after any review fix.
- [ ] Record leon and RWB Harness outcomes only from actual commands, then run their non-delivery `harness-enforce` gates.
- [ ] Report separately: local implementation, compatibility/RWB integration, remote CI not run, native platform/real host not run, and publication not performed.

## Completion condition

The goal is locally complete only when both repositories have clean task worktrees with local commits, all applicable local tests and mechanical gates pass, the shared runtime manifest verifies, RWB representative scenarios execute through the leon-owned kernel, and no required local item remains pending. Remote CI, native Windows/real-machine, host activation, push, merge, release, and global installation remain explicit external states unless separately authorized.
