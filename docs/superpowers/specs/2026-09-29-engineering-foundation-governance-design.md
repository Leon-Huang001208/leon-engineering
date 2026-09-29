# Engineering Foundation Governance Design

## Goal and constraints

`leon-engineering` becomes the single authoritative implementation for reusable project discovery, verification planning, evidence validation, managed distribution, and governance checks. Project repositories keep their path-to-domain mapping, supported-platform policy, commands, CI gates, and product acceptance. Host adapters keep Codex/Claude differences.

The design preserves existing public script paths, exported functions, CLI flags, error/exit behavior, plugin IDs, Hook configuration, installation manifests, and rollback guarantees. It does not publish, install globally, change RWB product behavior, or infer acceptance coverage from an architecture inventory.

## Chosen approach

The shared verification kernel is extracted into focused `lib/verification/` modules. Existing leon v1 and RWB v2/v3 formats are parsed by explicit compatibility adapters and normalized to one internal model. New projects use the proven v3 policy / v3 plan / v2 receipt envelopes; legacy envelopes remain read-only compatible and retain their exact public output when invoked through legacy entrypoints.

RWB consumes a manifest-owned minimal runtime snapshot committed under its project `.agents/runtime/` tree. The snapshot is generated only by an explicit preview/apply/verify/rollback tool from a fixed leon version and commit. The project wrappers import that local snapshot, so normal RWB users do not need a personal plugin, a home-directory path, a network fetch, or a floating `main` checkout.

Alternatives rejected:

1. Copying RWB planner code into leon and continuing both implementations would preserve duplicate authority.
2. Making RWB import a developer checkout or `~/.agents` runtime would violate reproducibility and the ordinary-user boundary.
3. Merging the existing platform branch before extraction would mix product fixes and a stale RWB base into framework work.

## Authority map

| Concern | Authority | Consumers |
| --- | --- | --- |
| Verification algorithms and protocol compatibility | `lib/verification/` | leon CLI, managed project runtime, tests |
| Project path, impact, command, platform, CI, and real-machine mapping | project `.agents/verification-policy.json` | shared planner |
| Architecture ownership and documentation/test locations | `docs/architecture-map.json` | map checker, developers, agents |
| Project mechanical constraints | project `.agents/project-constraints.json` | existing constraints checker |
| Host lifecycle and global installation | `adapters/` and existing installers | Codex/Claude hosts |
| Skill instructions | existing plugin Skill directories | host discovery |
| Historical plans and evidence | dated `docs/superpowers/`, `docs/archive/`, project reports | audits only |

## Internal verification model

The normalized model keeps independent dimensions instead of deriving one from another:

- `riskTier`: documentation/read-only, local-only, isolated, or full-delivery;
- `validationLevel`: L0 through L4;
- `platforms`: generic, Linux, macOS, Windows, cross-platform, and real-machine-required;
- `lane`: local, CI, or real-machine;
- `gate`: merge or release;
- `isolation`: current checkout, worktree, CI workspace, or physical device;
- `change`: paths, status, rename source/destination, origin, and comparison baseline;
- `evidence`: planned item, actual status, duration, source, regular-file reference, and freshness binding.

A worktree does not raise validation depth. A generic check does not prove every OS. A high-risk path selects the necessary gates declared by policy, not every unrelated platform.

## Planning and changed-set completeness

The existing repeated `--changed-file` mode remains for compatibility and focused fixtures. The canonical mode accepts a Git baseline and discovers, without modifying Git:

- committed changes between base and HEAD;
- staged changes;
- unstaged changes;
- untracked files not ignored by Git;
- deleted paths;
- both source and destination of renames.

Explicit paths cannot silently shrink a Git-discovered set. A mismatch is an error. The plan records base commit, HEAD, worktree state digest, policy digest, framework version/commit, and a canonical plan digest. Unknown or unsafe paths, unknown policy versions, missing references, or an empty insufficient closure fail closed.

The planner never executes catalog values. New catalog entries prefer argv arrays plus a relative working directory. Legacy string values remain opaque display data unless a separately allowlisted runner maps their stable verifier ID.

## Receipt and evidence model

The new receipt keeps the platform branch's proven distinction among local execution, CI merge gates, and real-machine release gates. `PASS` is the only positive proof. `FAIL`, `BLOCKED`, `NOT_RUN`, `SKIPPED`, and `MANUAL_REQUIRED` remain distinct; `NOT_REQUIRED` is illegal for a selected required gate.

Validation performs four independent checks:

1. strict schema and path safety;
2. canonical replanning against the current policy;
3. plan/baseline/framework digest equality;
4. complete status and evidence coverage for every selected gate.

Evidence JSON validity is not execution proof. Receipts identify their source (`runner`, `ci`, `manual`) and reference regular evidence files. Harness or CI may produce receipts; the validator only checks them and never runs their commands.

## Managed project runtime

`lib/project/managed-runtime.mjs` owns a deterministic file manifest for the minimal verification runtime. Its CLI defaults to preview and supports explicit apply, verify, and rollback. The manifest records framework version, framework commit, protocol versions, managed relative paths, and SHA-256 values.

All writes are preflighted as one batch. Foreign files, symlinks, unreadable files, drifted managed files, stale source commits, partial copies, or rollback collisions fail before replacement. Backups live in the Git common directory with private permissions; project-owned policy and wrappers are never overwritten by the runtime bundle.

## Repository governance

Root `README.md` and `AGENTS.md` become the current entrypoints. `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_MAP.md`, and `docs/architecture-map.json` state module ownership, source, authoritative docs, tests, and documentation triggers. `docs/README.md` separates current handbook, decisions, plans, evidence snapshots, generated material, and archive.

The map checker validates referenced paths, unique authority, tracked module coverage, and broken links. It does not claim tests passed or derive verification routes. Generated symbol/file indexes remain generated artifacts and are not copied into narrative documents.

## Framework self-use and CI

leon receives project-local `.agents/project-constraints.json` and `.agents/verification-policy.json`. Changes to the verification engine, policy, receipt validator, schemas, install/runtime distribution, adapters, Hooks, CI, or release files route to L4/full-delivery. Independent fixed contract tests validate the engine even if the changed router would produce an incorrect plan.

A lightweight GitHub workflow runs the standard-library Node suite, map/constraint checks, and `git diff --check`. Workflow YAML is locally checked and covered by contract tests. Until a real remote run exists, status remains “remote CI not run.”

## RWB integration

RWB integration starts from current remote `master` in a new worktree. It may change only engineering policy, managed runtime, thin wrappers, verification tests/Skill docs, and directly related engineering documentation. It must not carry over `service_manager.py` or other product changes from the platform branch.

The platform branch supplies proven schema-v3/receipt-v2 behavior and representative contracts. Its project policy remains RWB-owned. Real RWB tests run against the managed shared kernel. A separate framework fixture with no RWB paths proves independent reuse.

## Error handling, logging, and recoverability

Library functions throw stable typed errors without printing secrets or absolute user content. Thin CLIs emit bounded structured JSON errors and nonzero exits. Mutating tools log only operation class, stable code, counts, version, and manifest digest. Every runtime update is previewable, verifiable, and rollback-safe.

## Test strategy

- Freeze current leon v1 and RWB v2 behavior before replacement.
- Import the platform branch's generic protocol contracts without its product fix.
- Add failure-first tests for change discovery, unsafe paths, missing references, stale baselines, incomplete changed sets, receipt tampering, false PASS, missing platform gates, install drift, partial failure, and rollback collision.
- Run focused RED/GREEN tests after each slice, then the complete leon suite.
- Validate RWB in its own clean worktree with current project constraints and representative planner/receipt cases.
- Record remote CI, native platform, real-host activation, and publication as separate states.

## Non-goals

- No global installation, host restart, push, PR, tag, release, workflow dispatch, or GitHub settings change.
- No new dependency or service.
- No RWB business refactor or desktop-work reopening.
- No bulk conversion of other repositories.
- No automatic execution of commands from policy JSON.
