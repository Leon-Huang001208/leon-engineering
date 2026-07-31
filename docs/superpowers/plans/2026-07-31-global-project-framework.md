# Global Project Framework Implementation Plan

> Execute in the `codex/global-project-framework-20260731` worktree. The user approved the managed-global-default approach on 2026-07-31. Do not batch-edit user projects.

**Goal:** Provide a verified global Codex engineering baseline that works across projects while preserving each project's local rules and files.

**Architecture:** Keep the existing skill adapter intact. Add a second manifest for a bounded global policy block and six global documents. The adapter owns only the marker block, named documents, and its manifest; it rejects conflicts and does not touch unrelated Codex configuration or repositories.

**Tech:** Node.js built-in modules and test runner, SHA-256, Markdown, JSON, Git worktree.

## Step 1 — Specify the global installer contract (RED)

Files: `tests/codex-adapter.test.mjs`

1. Import the global installer, verifier, rollback function, and document-name constant.
2. Add tests for clean installation while preserving existing `AGENTS.md` text, foreign-document preflight rejection, drift detection, and rollback preservation.
3. Run `node --test tests/codex-adapter.test.mjs`; record the expected missing-export failure before any implementation code is written.

## Step 2 — Add canonical global policy and documentation

Files: `adapters/codex/global-policy.md`, `adapters/codex/global-docs/*.md`

1. Write the marker-bounded policy content: precedence, task-local project discovery, routing, evidence, and external-skill governance.
2. Add `GETTING_STARTED.md`, `STRUCTURE.md`, `COMMANDS_GUIDE.md`, `SKILLS_GUIDE.md`, `AGENTS_GUIDE.md`, and `SETTINGS_GUIDE.md`.
3. Link the documents to each other with repository-agnostic wording and no machine-specific secrets or runtime assumptions.

## Step 3 — Implement global adapter operations (GREEN)

Files: `scripts/install-codex-adapter.mjs`, `adapters/codex/manifest-schema.json`

1. Add exported `GLOBAL_DOCUMENT_NAMES`, `installGlobalFramework`, `verifyGlobalFramework`, and `rollbackGlobalFramework` functions.
2. Use `--codex-home` with `--install-global`, `--verify-global`, and `--rollback-global`; keep existing skill commands backward compatible.
3. Preflight all source files, foreign document conflicts, and marker ownership before atomic writes.
4. Log each success/failure with the existing structured logger; on any error return a clear message and do not take ownership of unvalidated files.
5. Store only framework-owned checksums in `~/.codex/.leon-engineering-global.json` and update its schema.

## Step 4 — Wire reusable skills and document ownership

Files: `skills/project-bootstrap/SKILL.md`, `skills/agent-routing/SKILL.md`, `skills/skill-health/SKILL.md`, `docs/README.md`

1. Add concise links to the global workflow guide and clarify that repository-level instructions override global defaults.
2. Make `project-bootstrap` task-local and authorization-gated for persistent project profiles.
3. Make `agent-routing` use the verified project profile and retain current worktree/role boundaries.
4. Make `skill-health` use the explicit discovery → vet → install → validate → promote lifecycle, without automatic installation.
5. Add a source-repository documentation index so skill and global-document ownership is discoverable.

## Step 5 — Verify and install

1. Run `node --test tests/codex-adapter.test.mjs` and the complete `node --test tests/*.test.mjs` suite.
2. Create an isolated temporary Codex home; exercise install, verify, drift detection, and rollback.
3. Run the production installer against the actual `~/.codex` only after temporary tests pass; then run its verify command.
4. Inspect the resulting diff in the worktree, record concrete results in `docs/pilot-results.md`, and create a task report if this repository's conventions require one.
5. Commit source changes. Do not push or modify user repositories beyond `~/.codex` without a separate authorization.

## Acceptance evidence

- Commands and their actual outputs are recorded in `docs/pilot-results.md`.
- The production verifier reports zero global-framework drift after installation.
- The skill adapter verifier continues to report zero drift.
- No repository under `/Users/leon/Desktop/Projects` is changed by this work.
