# Global Project Framework Design

## Goal

Extend `leon-engineering` from a shared skill catalog into a safe global engineering baseline for every Codex project. The baseline must be useful for frontend, backend, desktop, data, and documentation work without changing an existing repository merely because it is present on the machine.

## Decision

Use a managed global layer with explicit project adapters:

```text
canonical leon-engineering source
        |
        +-- seven reusable skills
        +-- global policy block and six workflow documents
                    |
                    v
              ~/.codex (explicit install)
                    |
                    v
   per-task project discovery -> project rules -> route -> verify -> handoff
```

The global layer supplies defaults only. A repository's `AGENTS.md`, path-scoped instructions, tooling, platform requirements, and user request take precedence. `project-bootstrap` records verified facts for the project at hand; it does not copy a generic project configuration into other repositories.

## Alternatives considered

1. **Managed global defaults with project adapters (selected).** Reuses the existing seven skills, preserves local policy, and can be verified or rolled back without deleting unrelated files.
2. Bulk-retrofit every trusted project with new instructions and CI. Rejected: it would create broad, unreviewed changes across unrelated repositories.
3. Automatically discover and install skills or build autonomous agent teams from the network. Rejected: provenance, permission, maintenance, and prompt-injection risks require explicit discovery and vetting.

## Components

| Component | Location | Responsibility |
|---|---|---|
| Managed policy block | `adapters/codex/global-policy.md` | Declares precedence, per-task onboarding, routing, verification, and no-bulk-mutation guarantees. |
| Global workflow documents | `adapters/codex/global-docs/` | Make the existing global `AGENTS.md` links real and document commands, skills, agents, and safe settings boundaries. |
| Global manifest | `~/.codex/.leon-engineering-global.json` | Separately records policy and document checksums; does not alter the existing skill manifest. |
| Adapter operations | `scripts/install-codex-adapter.mjs` | Explicit install, verify, and rollback of only global framework files it owns. |
| Existing skills | `skills/project-bootstrap`, `agent-routing`, `skill-health` | Use the policy consistently for onboarding, delegation, and skill lifecycle governance. |

## Global execution model

1. Interpret the user request and identify the target project; do not enumerate or modify other projects by default.
2. Read the target project's instructions and architecture entry points. Record only verified facts in a task-local report or, with authorization, in that project.
3. Route direct work, read-only investigation, isolated worktree changes, or an opt-in team using risk and coupling.
4. Implement only within the user-authorized scope; use the repository's package manager, logger, error-handling conventions, tests, and platform matrix.
5. Report actual validation commands, evidence, remaining uncertainty, and files changed. Do not represent an unrun platform check as passed.
6. For a prospective external skill, separate discovery, security vetting, explicit installation, validation, and later promotion. No automatic network installation or trust escalation occurs.

## Ownership and safety

The adapter adds a bounded marker block to an existing `~/.codex/AGENTS.md`; text outside the markers remains unchanged. It writes only the six named global documents and their dedicated manifest. Before installation it rejects a conflicting document or an unmanaged marker block. Verification detects edits in either managed area. Rollback removes only files and the policy block recorded by its manifest, and refuses to remove drifted managed content.

The existing `~/.codex/skills/.leon-engineering.json` remains the skill-only manifest. Keeping the manifests separate avoids breaking the already deployed seven-workflow adapter and prevents a global-document update from taking ownership of third-party skills.

## Non-goals

- Scanning, editing, committing, or pushing all repositories on the computer.
- Replacing project instructions, local CI, package managers, runtime versions, credentials, model settings, MCP configuration, or approval policy.
- Automatically installing skills, dependencies, plugins, or agents from the network.
- Claiming that a project or platform is verified before its own checks have run.

## Acceptance criteria

- A clean Codex home can receive the global policy and all six linked documents with an inspectable manifest.
- Existing custom global rules remain byte-for-byte unchanged outside the managed markers.
- Foreign global documents and unmanaged marker blocks are rejected before any write.
- Verify reports document or policy drift, and rollback preserves user-owned content.
- The global documentation explicitly teaches the project-adapter flow and skill governance for all project types.
- The three updated skills link to the same source-of-truth documentation without overlapping each other.
