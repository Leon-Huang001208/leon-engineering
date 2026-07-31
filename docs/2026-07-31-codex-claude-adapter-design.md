# Codex–Claude Code Shared Framework Adapter Design

## Goal

Make the `leon-engineering` framework usable and verifiable in both Claude Code and Codex without duplicating workflow content or importing the legacy global catalog.

## Scope

This change adapts the existing seven workflows and seven role definitions:

- Workflows: `project-bootstrap`, `feature-loop`, `bugfix-evidence`, `review-ship`, `logging-observability`, `agent-routing`, and `skill-health`.
- Roles: `repo-explorer`, `planner`, `implementer`, `code-reviewer`, `security-reviewer`, `ci-triage`, and `docs-mapper`.

It does not migrate legacy Claude commands, legacy global skills or agents, credentials, MCP servers, hooks, or project-specific rules.

## Architecture

`/Users/leon/Developer/claude-engineering/skills/*/SKILL.md` remains the sole human-maintained workflow source.

```text
canonical workflows in leon-engineering/skills
             ├── Claude Code plugin discovery
             └── Codex adapter installer
                        └── ~/.codex/skills/<workflow>/SKILL.md
```

The Codex adapter makes explicit copies, not symlinks. An installed manifest records the framework version, source commit, copied workflow names, and checksums. This keeps a running Codex installation stable until an explicit adapter update and makes drift detectable.

The existing Claude Code `agents/*.md` stay as persistent, tool-restricted named agents. Codex receives the same responsibilities through a reference owned by `agent-routing`: it supplies precise delegation templates and verification requirements, while the primary Codex agent selects the route and creates a short-lived agent.

Codex roles are therefore not generic by default: each delegated task must name a role, state its read/write boundary, acceptance criteria, allowed paths or worktree, and evidence format. Codex does not currently have a Claude-equivalent global named-agent file with per-role tool restrictions, so read-only behavior is verified by an isolated fixture and a clean Git diff; it is not represented as an unconditional runtime deny-list.

## Components

| Path | Change | Responsibility |
|---|---|---|
| `scripts/install-codex-adapter.mjs` | Create | Dry-run, install, verify, and rollback the Codex skill copies and manifest. |
| `tests/codex-adapter.test.mjs` | Create | Test ownership checks, installation, drift detection, and rollback in a temporary target. |
| `adapters/codex/` | Create | Codex-only skill metadata and the installation manifest schema. |
| `skills/agent-routing/references/codex-role-templates.md` | Create | Bounded role prompts and evidence requirements for Codex delegation. |
| `skills/agent-routing/SKILL.md` | Modify | Direct Codex users to the role-template reference only when delegating. |
| `docs/codex-adapter-pilot.md` | Create | Disposable-repository test scenarios and expected evidence for both tools. |
| `/Users/leon/.codex/AGENTS.md` | Modify last | Normalize the Codex skill path and point to installed shared workflows. |
| `/Users/leon/.codex/skills/` | Modify last | Receive only adapter-owned workflow directories and manifest. |

## Installation and rollback

The adapter supports these commands:

1. `--dry-run`: print the exact targets without changing files.
2. `--target <directory>`: use a temporary test directory instead of `~/.codex/skills`.
3. `--install`: reject an existing non-adapter-owned target, copy all workflows and Codex metadata, write the manifest atomically, and verify checksums.
4. `--verify`: compare every installed skill and manifest checksum to the canonical source.
5. `--rollback`: remove only directories listed in the adapter-owned manifest and preserve pre-existing skills.

Before the real install, create a timestamped backup of `/Users/leon/.codex/AGENTS.md`. The installer never overwrites an unrelated skill directory, deletes Claude assets, or changes Codex model, approval, sandbox, plugin, MCP, or provider configuration.

## Cross-tool role contract

| Role | Claude Code enforcement | Codex enforcement and evidence |
|---|---|---|
| `repo-explorer`, `planner`, `code-reviewer`, `security-reviewer`, `ci-triage`, `docs-mapper` | Named agent with read-only tool restrictions | Delegation template prohibits edits; disposable fixture must retain a clean diff. |
| `implementer` | Named agent with worktree isolation | Delegation template requires a named worktree and reports its path; fixture must show the parent checkout unchanged. |

No role may create a nested agent. Secret, destructive, dependency, remote mutation, release, migration, CI, and global-configuration actions remain escalation points in both tools.

## Verification

1. Write adapter tests before its implementation and observe the missing installer fail.
2. Run the adapter test suite against a temporary target; verify install, idempotent verification, drift detection, rejection of foreign directories, and rollback preservation of an unrelated skill.
3. Run the source catalog, guard, audit, and adapter tests; validate the Claude plugin manifest.
4. Install to `~/.codex/skills` only after the temporary-target checks pass. Confirm the installed manifest and checksums.
5. In a disposable Git repository, start a fresh Codex invocation that requests `project-bootstrap` and confirm the workflow is discoverable. Delegate the `repo-explorer` template and verify no diff. Run the `implementer` template in a worktree and verify the parent checkout remains clean.
6. Run the existing Claude plugin catalog tests and confirm `claude plugin details` still reports seven workflows, seven agents, and two hooks. Interactive Claude Code testing remains separate from the known non-interactive CLI responsiveness problem.

## Error handling

The installer returns a non-zero result and a clear actionable message for missing canonical workflows, malformed metadata, checksum mismatch, foreign target conflict, invalid manifest, incomplete copy, or attempted rollback without an adapter-owned manifest. It does not partially install after a failed preflight.

## Acceptance criteria

- The seven workflow bodies have one maintained source and are verified identical after Codex installation.
- Codex has an explicit, inspectable catalog manifest and cannot overwrite `pdf`, `playwright`, or another foreign global skill.
- Codex role delegation is bounded, testable, and differentiates read-only roles from the worktree-only implementer.
- The existing Claude plugin remains valid and unchanged in behavior except for the shared role-template reference.
- Both tools have recorded, non-sensitive evidence from their own runtime or a clearly labelled runtime limitation.

## Non-goals

- Automatic migration or deletion of legacy Claude assets.
- A permanent static Codex named-agent registry or tool-deny policy that Codex does not support.
- Changes to global model providers, credentials, MCP servers, permissions, hooks, or project instructions beyond the Codex skill-path correction.
