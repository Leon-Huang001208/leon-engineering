# Codex Execution Token Efficiency Program Design

## Program goal

Reduce Token and model-round cost for Codex tasks across projects while preserving answer quality, error visibility, permissions, security, recoverability, and every applicable verification/delivery hard gate. ResearchWorkbench is the final acceptance pilot, not the configuration owner.

The program is split into three independently deliverable phases:

1. **Execution Core 0.19.2** — repair false health signals, worktree-scoped Harness loss, prepared-revision churn, and missing redacted usage telemetry.
2. **Global Context Portfolio** — safely deduplicate and relocate global Skills, repair global Hook installation, and A/B-test plugin/reasoning profiles before applying user configuration.
3. **ResearchWorkbench Pilot** — validate read-only, local-only, isolated, and full-delivery tasks against the optimized Codex runtime, then finish recovery-worktree reconciliation.

Each phase gets its own implementation plan, commits, review, delivery receipt, rollback, and measurable acceptance. A later phase cannot be used to hide a failed earlier phase.

## Evidence baseline

### Fixed context

Current `codex debug prompt-input` on 2026-09-23 is 67,993 characters with 184 `SKILL.md` references. Its largest string is 47,699 characters. Global inventory currently exposes:

- 119 directories under `~/.agents/skills`;
- 31 directories under `~/.codex/skills`;
- 182 unique Skill names in the installed plugin cache;
- 18 explicitly enabled plugins in `~/.codex/config.toml`;
- `gpt-5.6-sol` with default reasoning effort `high`.

Single-plugin static removal shows that visible prompt cost is concentrated in duplicated Skill surfaces: disabling `leon-engineering@leon-local` removes 2,203 characters and 9 Skill references, while several enabled plugins remove zero visible prompt characters because a same-name global copy remains.

### Real task history

Twenty-one local Codex session files associated with the active goal contain:

- 91 turn contexts;
- 1,250 model usage records;
- 1,162 tool calls;
- 5,209,915 model-visible tool-output characters;
- 2,610,605 input tokens, of which 2,583,552 were cached;
- 13,583 output tokens and 5,728 reasoning tokens.

Fifteen single-turn automatic continuations alone account for 159 model calls, 144 tool calls, 888,334 tool-output characters, and 1,039,380 input tokens. These values are local usage records, not an API invoice; they establish relative mechanisms and decision baselines.

### Current runtime health

- Plugin-only distribution verification is `valid:true`.
- Legacy default `install-codex-adapter.mjs --verify` incorrectly reports 21 missing/drifted Skills after successful plugin-only migration.
- Global verification reports one real drift: managed `~/.codex/hooks.json` is missing while the global manifest says the installer owned it.
- The active host may still use cached Hooks; disk installation and host activation are distinct states.

## Phase 1 — Execution Core 0.19.2

### 1. Migration-aware adapter verification

`install-codex-adapter.mjs --verify` becomes the default current-health command when no explicit `--target` is supplied:

- if a plugin-distribution manifest exists, verify plugin-only distribution instead of requiring retired Skill directories;
- verify the global framework and Harness runtime in the same bounded result;
- return separate `pluginDistribution`, `globalFramework`, and `runtime` sections plus one overall `valid` and deduplicated `drift` list;
- retain `--verify-plugin-only` and `--verify-global` for targeted diagnosis;
- retain legacy direct-Skill verification only when `--target` is explicitly supplied;
- never repair during verification.

This eliminates the current false 21-Skill drift without weakening exact checksum checks.

### 2. Worktree-stable Harness storage

Harness task, index, metrics, events, sessions, verifiers, and observation logs must survive removal of a feature or integration worktree.

For Git repositories, resolve one canonical Harness storage root from the Git common directory and repository identity. Store private state below the common Git administration directory, alongside managed delivery state, with mode 0700 directories and 0600 files. All worktrees for the repository resolve to the same root. For non-Git/projectless tasks, keep the existing project-local `.ai/harness` behavior.

Migration rules:

- preview reports legacy and destination paths without writing;
- explicit migration copies and hashes every record before switching;
- refuse symlinks, unreadable records, duplicate task IDs with different content, and any destination outside the resolved boundary;
- keep the legacy directory until destination verification completes;
- write a versioned migration manifest and rollback map;
- no goal, acceptance text, command, path, Prompt, or secret enters audit events beyond existing task-record contracts.

`harness-session`, `harness-project`, `harness-execution`, `harness-evaluate`, Hook recovery, and `harness-enforce` must all resolve the same storage root. A delivery flow can record outcome before or after controller cleanup without reconstructing chronology.

### 3. Safe prepared-revision replacement

Add an explicit controller operation, exposed as `--prepare --replace-prepared`, for review fixes made after a clean prepared revision but before publication.

The replacement is allowed only when:

- receipt status is exactly `prepared`;
- the integration worktree exists and is clean;
- feature HEAD differs from the receipt's feature commit;
- remote default still equals receipt base commit;
- prepared integration commit is not contained in remote default;
- no CI run or pull request is associated with the prepared revision;
- all managed paths and branches pass normal safety checks.

The controller records the old branch/worktree/commit in `integrationHistory` with `status: "superseded"`, removes the clean old integration worktree non-forcibly, and prepares the next numbered revision from the unchanged remote base plus current feature branch. Any failed condition preserves the old prepared state and fails closed.

This prevents the extra intermediate publication and CI run observed for a one-paragraph review fix.

### 4. Redacted Token audit

Add `scripts/token-audit.mjs` with two read-only entrypoints:

- one explicit session JSONL path;
- one explicit thread ID plus an explicit session root.

Output only:

- session/turn/model-call/tool-call counts;
- input, cached, non-cached, output, and reasoning token totals;
- tool-output bytes and percentiles;
- exact repeated-call counts based on hashed normalized arguments;
- stable tool-category counts;
- SHA-256 of each analyzed source file.

Never output message bodies, Prompt text, tool arguments, commands, paths from tool payloads, secrets, or user content. Default stdout is at most 4 KiB; a complete JSON report may be written only to an explicit safe output path with mode 0600. Malformed or partial files are reported individually and never silently treated as zero.

### 5. Automatic-continuation and output policy

Update the canonical shared global policy and docs with mechanical, testable guidance:

- independent read-only checks are batched into one tool boundary;
- known noisy commands return structured summaries, counts, hashes, and exact log references rather than raw logs;
- a turn waiting solely for user authority performs no repeated diagnostics unless external state can change the decision;
- the same user-input blocker produces one concise request, one no-change audit, then a real blocked transition at the required threshold;
- heartbeat runs remain silent unless state changes materially;
- retries reuse the same process/session/receipt instead of starting duplicate work;
- these rules never shorten required tests, hide errors, bypass permissions, or weaken delivery gates.

Catalog tests must assert the wording and the 4/8 KiB limits. This phase does not attempt to rewrite arbitrary tool results in a Hook; blocking normal tools for omitted output limits would create more retries than it saves.

### 6. Phase 1 delivery

Phase 1 changes shared adapters, Harness storage, delivery state, tests, docs, runtime installation, and plugin release metadata. It therefore requires:

- isolated feature and integration worktrees;
- RED→GREEN tests for every new state transition and migration failure;
- full framework tests and native Node platforms already supported by the repository;
- version `0.19.2` or the next available patch version;
- direct/default-branch managed delivery or protected-branch PR fallback;
- remote CI, cleanup, and Harness delivery enforcement;
- plugin/global/runtime installation verification;
- explicit user authorization immediately before writing global Codex state;
- full Codex host restart before behavioral activation claims.

## Phase 2 — Global Context Portfolio

### Lifecycle classes

Every global Skill is assigned one of four actions. Zero observed usage is never sufficient deletion evidence.

#### A. Exact duplicate — migrate from `~/.agents/skills`

The following 18 directories are byte-for-byte identical to an installed plugin Skill and may be removed from global discovery only through a checksum-guarded backup/migration:

- `bugfix-evidence`
- `cross-domain-transfer`
- `dual-layer-explanation`
- `expert-perspectives`
- `fact-checking`
- `feature-loop`
- `first-principles`
- `horizontal-vertical-analysis`
- `logging-observability`
- `minimal-experiment`
- `project-adapter`
- `project-bootstrap`
- `project-constraints`
- `reverse-engineering`
- `review-ship`
- `skill-health`
- `socratic-clarification`
- `steelman-comparison`

The following 7 directories are byte-for-byte identical to a retained `~/.codex/skills` copy and may be removed from `~/.agents/skills` through the same mechanism:

- `brainstorming`
- `caveman`
- `diagnose`
- `finishing-a-development-branch`
- `github`
- `openclaw-pr-maintainer`
- `release`

The migration tool records source, canonical destination, tree hash, file count, bytes, backup path, and rollback status. It moves only exact matches; any changed file stops the batch before mutation.

#### B. Project-specific — leave global discovery

- `zq`: quarantined immediately on 2026-09-23 because it contained plaintext credentials, runtime state, locks, caches, and project-specific crawler code. It must not be restored globally. After credential rotation and security redesign, its capability becomes a ResearchWorkbench DataHub/Integration Provider; Product Skills call the provider and never load plaintext `config.yaml`.
- `cls` and `cnstock`: migrate to ResearchWorkbench DataHub providers or project-owned connector code.
- `data-connector-development`: migrate to ResearchWorkbench `.agents/skills` as a developer workflow.
- `wind-find-finance-skill` and `wind-mcp-skill`: compare global, new-project, and legacy-project versions; retain one project-owned current version and quarantine global copies only after behavior parity.
- `multi-format-rag`: move to a ResearchWorkbench optional capability/plugin or retire after comparison with `document-reading`; its 31.5 MB folder must not remain an always-discovered global Skill.

Project migrations strip secrets, state, locks, outputs, compiled caches, and local environment files. They do not copy credential-bearing configuration.

#### C. Optional command catalog

There are 44 `source-command-*` wrappers. `source-command-hello` is retired. The remaining 43 move to a default-disabled optional commands plugin after mapping each command to its real underlying Skill/agent and proving help/dispatch parity. Missing or unique commands remain quarantined until reviewed; no mass name-based deletion.

#### D. Repair or retire

- `self-improving-agent`: missing `../playwright-pro/` reference.
- `skill-creator`: missing `references/templates/` reference.
- `write-a-skill`: missing `REFERENCE.md` reference.

For each, verify unique capability and owner. Repair the reference if the capability is retained; otherwise quarantine with manifest and rollback. No broken Skill remains in active discovery.

### Security quarantine already completed

`~/.agents/skills/zq` was moved intact to `~/.agents/quarantine/zq-20260923`; both directories have mode 0700 and the manifest has mode 0600. Tree SHA-256 is `210ffc19bdde590a5461dd9143ddd039c31f77872276b03ef1920975ff6859f6`. No file was deleted. Credential rotation remains an external user action and is a hard prerequisite for any ResearchWorkbench adaptation.

### Plugin and reasoning profiles

After Skill dedup and a full host restart, rerun static contribution measurement. Then test:

- default enabled plugins versus a reversible lean plugin set;
- `high` versus `medium` default reasoning on fixed read-only, local-edit, architecture, and delivery-planning tasks.

The profile manager must back up `~/.codex/config.toml`, own only an allowlisted set of plugin `enabled` values and `model_reasoning_effort`, preserve every other byte/value, write atomically, verify readback, and support rollback. No config mutation occurs until a preview is shown and the already-granted system-configuration authority is revalidated against the exact diff.

Promotion requires strict positive reduction in input, non-cached input, and weighted usage while quality is fully correct and errors, tool calls, permissions, and required gates do not worsen. Static prompt reduction alone is insufficient.

## Phase 3 — ResearchWorkbench acceptance pilot

Run the same fixed ResearchWorkbench commit through four task classes before and after the optimized Codex host restart:

1. read-only code/location question;
2. narrow reversible local edit;
3. framework-specific minimum verification;
4. full-delivery planning/receipt validation without an unnecessary production change.

Record model, reasoning, prompt hash, commit, calls, tools, input/cached/non-cached/output/reasoning, output characters, errors, permissions, selected tests, CI gates, and answer/behavior grading. Use crossed order and fixed sample count. No extra samples after seeing results.

ResearchWorkbench acceptance passes only if:

- every answer and behavior remains correct;
- framework source selects architecture plus its three component tests;
- known framework tests remain local-only and unmapped tests remain full-delivery;
- no desktop gate leaks into Web-only work;
- all applicable local/CI/Harness gates remain intact;
- aggregate usage strictly improves under the approved metric;
- the recovery worktree remains preserved until its remaining data is independently classified and approved for archival/removal.

## Security and privacy boundaries

- Never print or commit Skill credentials, config values, session bodies, prompts, tool arguments, cookies, tokens, or account names.
- Secret-bearing Skills are quarantined before analysis; only metadata and hashes enter reports.
- Global state changes are atomic, checksum-guarded, backed up, mode-restricted, and individually reversible.
- No `rm -rf`, force-push, force worktree removal, or silent skip of unreadable files.
- New dependencies require separate authorization; the preferred implementation uses Node standard library only.
- Existing user-owned or foreign Skills are never moved solely because they are unused or share a name.

## Program artifacts

- Phase-specific specs and plans under `docs/superpowers/`.
- `scripts/token-audit.mjs` plus tests.
- migration-aware adapter verification and safe replace-prepared controller support.
- shared Harness storage migration plus rollback tests.
- `scripts/skill-portfolio.mjs` for audit/preview/apply/rollback and a versioned manifest schema.
- a default-disabled optional commands plugin or a documented quarantine decision.
- redacted Phase 1/2 reports and final ResearchWorkbench A/B report.
- installation, restart-required, post-restart activation, rollback, CI, and cleanup receipts.

## Program acceptance

- No false 21-Skill drift from the default adapter health command.
- Global Hook/runtime/plugin distribution verify with zero drift after authorized installation and restart.
- Harness outcome/enforcement survives normal feature/integration cleanup without reconstruction.
- A clean prepared revision can be safely superseded without an intermediate publication or CI run.
- Token audit reproduces session metrics without content disclosure and returns bounded output.
- Exact duplicate and project-specific Skills leave global discovery only through verified backup manifests; all non-exact collisions remain untouched until reviewed.
- `zq` stays quarantined and no plaintext credential is copied into ResearchWorkbench.
- Broken Skill references are repaired or quarantined.
- Global plugin/reasoning changes are promoted only by quality-preserving A/B evidence.
- ResearchWorkbench pilot preserves all verification boundaries with strict positive usage improvement.
