# Codex Context Portfolio 0.19.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce always-discovered Codex Skill and plugin context through checksum-guarded deduplication, project ownership, optional command packaging, broken-reference retirement, and reversible profile experiments.

**Architecture:** Add two standard-library tools: `skill-portfolio.mjs` owns preview/apply/rollback manifests for exact Skill moves, while `codex-profile.mjs` owns an allowlisted slice of `config.toml`. Package command wrappers in a default-disabled plugin, move project capabilities to ResearchWorkbench only after sanitized comparison, and promote no runtime profile without quality-preserving A/B evidence.

**Tech Stack:** Node.js ESM and standard library, `node:test`, JSON manifests, Codex/Claude plugin manifests, existing Skill directories.

**Spec:** `docs/superpowers/specs/2026-09-23-codex-token-efficiency-program-design.md`

## Global Constraints

- No new dependency and no credential-bearing content enters the repository.
- `zq` remains quarantined; adaptation is blocked until external credential rotation.
- A move requires an exact source tree hash and an explicit destination/backup; zero observed use is never deletion evidence.
- Global mutations stay within `~/.agents/skills`, `~/.agents/quarantine`, `~/.codex/config.toml`, and explicitly selected ResearchWorkbench `.agents/skills` paths.
- Every mutation is previewed, backed up, atomically manifested, read back, and individually reversible.
- The profile manager may change only plugin `enabled` values and `model_reasoning_effort`; every other config byte/value is preserved.
- Prompt reduction alone cannot promote a profile; quality, errors, permissions, tools, and hard gates must remain correct.

## Review Focus

- A source Skill changed after preview must stop the whole batch before the first move; Task 1 tests stale hashes.
- A rollback target that now exists or whose backup drifted must fail closed; Task 1 tests both.
- A project migration must exclude credentials, locks, caches, outputs, and environment files; Task 3 tests a secret-bearing fixture.
- Optional commands with missing or non-unique underlying capability must remain quarantined instead of being packaged as working; Task 4 tests the mapping gate.
- Config comments, ordering, unrelated tables, model, provider, approvals, and sandbox settings must survive profile apply/rollback byte-for-byte; Task 5 tests a representative config.

---

### Task 1: Checksum-guarded Skill portfolio tool

**Files:**
- Create: `scripts/skill-portfolio.mjs`
- Create: `tests/skill-portfolio.test.mjs`
- Modify: `scripts/harness-runtime.mjs`
- Modify: `tests/harness-runtime.test.mjs`
- Modify: `adapters/codex/global-docs/SKILLS_GUIDE.md`

**Interfaces:**
- `auditSkillTree(path) -> {treeHash,fileCount,bytes,files}`.
- `previewSkillPortfolio({manifestPath}) -> {valid,actions,conflicts,summary}`.
- `applySkillPortfolio({manifestPath}) -> receipt`.
- `rollbackSkillPortfolio({receiptPath}) -> receipt`.

- [ ] Write failing tests for exact move, stale source hash, symlink/unreadable entry, destination collision, private backup/receipt permissions, and rollback drift.
- [ ] Run `node --test tests/skill-portfolio.test.mjs`; expect module-not-found RED.
- [ ] Implement deterministic tree hashing, manifest validation, full-batch preflight, same-volume rename with verified-copy fallback, 0700 backups, 0600 receipts, and rollback without force.
- [ ] Add preview/apply/rollback CLI modes. Default is preview; apply and rollback require explicit flags.
- [ ] Install the script through `HARNESS_RUNTIME_FILES`, document exact boundaries, and run `node --test tests/skill-portfolio.test.mjs tests/harness-runtime.test.mjs tests/catalog.test.mjs`.
- [ ] Commit `feat: add reversible Skill portfolio migrations`.

### Task 2: Exact duplicate retirement

**Files:**
- Create: `docs/2026-09-23-skill-portfolio-actions.json`
- Create: `docs/2026-09-23-skill-portfolio-report.md`
- Modify only through the portfolio tool: exact listed directories under `~/.agents/skills`.

**Interfaces:**
- Consumes the 18 exact plugin duplicates and 7 exact `~/.codex/skills` duplicates from the approved spec.
- Produces one preview hash, one private backup root/receipt, post-apply prompt inventory, and rollback command.

- [ ] Generate current hashes and canonical destinations; abort the batch if any item is no longer exact.
- [ ] Preview all 25 moves and record file counts/bytes/tree hashes without file content.
- [ ] Apply the exact batch under the user's existing global-migration authorization, verify sources absent/backups exact/canonical copies present, and keep backups.
- [ ] Rerun `codex debug prompt-input` and record characters/Skill references without claiming Token savings.
- [ ] Commit only the redacted action manifest/report; never commit user absolute backup paths or config values.

### Task 3: Project-specific and broken Skill lifecycle

**Files:**
- Modify ResearchWorkbench project Skill directories only for sanitized retained capabilities.
- Create redacted manifests/reports under `docs/`.
- Modify global Skill locations only through Task 1's tool.

**Interfaces:**
- `cls`, `cnstock`, and `data-connector-development` become ResearchWorkbench-owned.
- `wind-*` keeps the behaviorally strongest project copy; non-exact variants remain until parity is proven.
- `multi-format-rag` becomes optional/project-owned or is quarantined with a reason.
- `self-improving-agent`, user `skill-creator`, and `write-a-skill` are repaired only if unique; otherwise quarantined with rollback.

- [ ] Audit each tree for secrets/state/locks/caches/outputs and compare same-name project copies.
- [ ] Write failing sanitizer/ownership tests using fixtures containing `config.yaml`, `.env`, locks, caches, and compiled files.
- [ ] Copy only approved regular source/docs/assets into ResearchWorkbench; validate each retained Skill and update its documentation.
- [ ] Quarantine superseded global copies with manifests; keep `zq` quarantine unchanged and record credential rotation as an external blocker.
- [ ] Verify RWB project Skill discovery and global absence without running finance/network capabilities.

### Task 4: Default-disabled optional command plugin

**Files:**
- Create: `plugins/leon-engineering-commands/.codex-plugin/plugin.json`
- Create: `plugins/leon-engineering-commands/.claude-plugin/plugin.json`
- Create: `plugins/leon-engineering-commands/skills/`
- Create: `plugins/leon-engineering-commands/command-map.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `tests/catalog.test.mjs`

**Interfaces:**
- Packages only source-command wrappers whose underlying Skill/agent exists and whose help/dispatch mapping is unique.
- `source-command-hello` is quarantined as retired.
- Ambiguous/missing mappings remain quarantined and are listed, not silently packaged.

- [ ] Write failing catalog tests for manifest names/version, default-not-installed marketplace status, mapping completeness, and the retired hello command.
- [ ] Generate mappings from wrapper instructions and validate every referenced capability against the retained catalog.
- [ ] Copy verified wrappers into the optional plugin, update Skill docs if paths change, and validate all Skill/plugin manifests.
- [ ] Use Task 1 to quarantine global wrappers only after packaged tree hashes and mapping parity pass.
- [ ] Run catalog and plugin validation, then commit `feat: package optional source commands`.

### Task 5: Reversible Codex profile manager and A/B fixtures

**Files:**
- Create: `scripts/codex-profile.mjs`
- Create: `tests/codex-profile.test.mjs`
- Create: `docs/codex-profile-experiment.md`
- Modify: `scripts/harness-runtime.mjs`
- Modify: `adapters/codex/global-docs/SETTINGS_GUIDE.md`

**Interfaces:**
- `previewProfile({configPath, profilePath}) -> exact allowlisted diff`.
- `applyProfile(...) -> private backup/receipt`.
- `rollbackProfile(...)`.
- Profiles may contain only `model_reasoning_effort` and plugin `enabled` booleans.

- [ ] Write failing tests for byte-preserved unrelated TOML, invalid keys, missing plugins, atomic apply, readback, stale backup, and rollback.
- [ ] Implement a line-preserving allowlisted editor without a TOML dependency.
- [ ] Add fixed A/B task manifest fields: commit, prompt hash, model, reasoning, calls, tools, input/cached/non-cached/output/reasoning, errors, permissions, gates, and quality grade.
- [ ] Install/document the tool and run its focused tests plus the full framework suite.
- [ ] Preview but do not promote the lean/medium profile until a post-restart fixed-sample A/B satisfies every promotion gate.

### Task 6: Release, apply, restart boundary, and handoff

**Files:**
- Bump all plugin manifests/marketplace entries to 0.19.3.
- Update `docs/pilot-results.md` with separated source, install, restart, and A/B receipts.

**Interfaces:**
- Produces published/default-branch source, verified global migrations, installed tools, and `restart_required` status.

- [ ] Run a whole-branch review; fix Critical/Important findings with RED→GREEN tests and record deferred minors.
- [ ] Run `node --test tests/*.test.mjs`, plugin/Skill validators, `git diff --check`, managed publish/status/cleanup, and Harness enforcement.
- [ ] Preview and apply the exact Skill portfolio batches, then verify global discovery and rollback receipts.
- [ ] Install 0.19.3 managed global files and verify migration-aware health, runtime, and plugin distribution.
- [ ] Record `restart_required`; after the user restarts the Codex host, run one fresh health/context canary before any profile A/B or activation claim.
