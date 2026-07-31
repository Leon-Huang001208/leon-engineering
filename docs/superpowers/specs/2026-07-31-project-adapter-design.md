# Project Adapter Design

## Goal

Give every future Codex task a consistent, evidence-based way to adapt the global framework to a user-selected project without treating all local repositories as one system or silently modifying them.

## Decision

Implement a read-only project-profile generator and a focused `project-adapter` skill. The generator inspects a bounded list of conventional files beneath one explicitly supplied project root, emits a schema-validated JSON profile, and never runs the project. Persisting that profile is an opt-in operation that writes only `.ai/project-profile.json` and refuses to overwrite it unless the user explicitly requests replacement.

```text
user-selected project
        |
        v
project-adapter skill
        |
        +-- read fixed evidence paths
        +-- emit ProjectProfile (stdout / Markdown view)
        +-- select matching existing workflows and validation candidates
        |
        +-- optional explicit persistence: .ai/project-profile.json
```

The profile is evidence, not authority: user instructions, repository `AGENTS.md`, path-scoped rules, and project tooling remain higher priority. It creates no central registry and does not enumerate trusted-project settings.

## Alternatives considered

1. **Read-only generator with explicit persistence (selected).** Reproducible across project types, testable, and safe for unfamiliar repositories.
2. Manual Markdown onboarding notes only. Low implementation cost, but inconsistent fields and no automated safety checks make routing and verification unreliable.
3. Scan every configured or discoverable project into a central registry. Rejected because scope, ownership, privacy, stale data, and accidental-write risks outweigh its convenience.

## Components

| Component | Responsibility |
|---|---|
| `skills/project-adapter/SKILL.md` | Trigger, scope boundary, profile use, explicit persistence rule, and handoff to existing skills. |
| `scripts/profile-project.mjs` | Node CLI and reusable functions for bounded discovery, profile creation, JSON/Markdown formatting, and opt-in writes. |
| `adapters/codex/project-profile-schema.json` | JSON Schema for the stable `ProjectProfile` contract. |
| `tests/project-profile.test.mjs` | Fixture-based behavior tests for evidence collection, read-only execution, refusal to overwrite, and CLI formatting. |
| Existing global docs and catalog tests | Document the new workflow, ownership, and adapter installation as the eighth shared skill. |

## Profile contract

`ProjectProfile` has a stable `schemaVersion`, absolute `projectRoot`, and only facts backed by a discovered path. It contains:

- `instructions`: discovered `AGENTS.md` and selected architecture/development documents;
- `ecosystems`: detected Node, Python, Rust, Go, and Tauri manifests or directories;
- `commands`: candidate test/lint/build commands, labelled `candidate` and tied to their manifest source; they are never represented as executed;
- `ci`: conventional workflow/configuration files;
- `platformSignals`: files or directories that indicate browser, desktop, or container responsibilities;
- `evidence` and `uncertainties`: explicit paths and limitations needed for safe follow-up work.

Discovery is deliberately shallow and deterministic: root-level conventional files, `docs/` entries named by the global workflow, and direct `.github/workflows/*.{yml,yaml}` files. The generator does not recursively read source code, execute package scripts, parse credentials, traverse sibling directories, access network resources, or inspect global trust settings.

## Interfaces and safety

The CLI requires `--project <directory>` and supports:

```bash
node scripts/profile-project.mjs --project /absolute/project --format json
node scripts/profile-project.mjs --project /absolute/project --format markdown
node scripts/profile-project.mjs --project /absolute/project --write-profile
node scripts/profile-project.mjs --project /absolute/project --write-profile --replace-profile
```

The default is read-only. `--write-profile` is a meaningful external write and is used only after the user authorizes persistence in that exact project. It rejects `/`, the current home directory, a non-directory target, an existing profile, invalid option combinations, and a resolved destination outside the project root. `--replace-profile` is accepted only with `--write-profile`. Writes are atomic and emit structured, non-sensitive lifecycle logs to stderr. The generated profile excludes file contents, environment variables, secrets, tokens, and command output.

An existing profile is not silently refreshed. The caller must consciously use `--replace-profile`, then review the resulting diff in that project. The framework source never writes profiles to user projects during its own tests or installation.

## Workflow integration

1. Use `project-adapter` when an unfamiliar project needs task routing or validation planning.
2. Review the profile's evidence and uncertainties with the task request; read the actual project instructions before acting.
3. Route to `feature-loop`, `bugfix-evidence`, `logging-observability`, `agent-routing`, or `review-ship` as appropriate.
4. Treat candidate commands as starting points to verify, not proof of passing checks.
5. Promote a repeated pattern only through `skill-health`'s discovery → vet → approved install → isolated validation → promotion lifecycle.

## Error handling

The generator throws clear errors and returns a non-zero CLI status for a missing project option, invalid directory, invalid format, malformed `package.json`, unsafe persistence target, existing profile without replacement, or write failure. It logs only event type and safe summary fields; it does not include file contents or environment data.

## Testing and acceptance

- A temporary fixture with `AGENTS.md`, `package.json`, `pyproject.toml`, `src-tauri/`, and a CI workflow produces the expected evidence, ecosystems, candidate commands, and platform signals.
- Default generation makes no `.ai` directory or other fixture write.
- Persistence writes only the profile path; a second write fails until `--replace-profile` is present.
- CLI JSON and Markdown output are deterministic enough for assertions; malformed manifests and unsafe roots fail clearly.
- Catalog, adapter, guard, and audit regressions remain green; the Codex adapter installs and verifies all eight skills without taking ownership of unrelated skills or documents.
- Production activation targets only `~/.codex`; no existing project repository is scanned or changed as part of framework installation.

## Non-goals

- Bulk onboarding, central indexing, or monitoring of local projects.
- Running tests, linters, builds, browsers, CI, migrations, or package installation during profile discovery.
- Replacing project instructions, guessing secret-bearing configuration, or writing profiles by default.
- Automatic discovery, installation, or promotion of external skills and agents.
