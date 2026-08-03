# High-Throughput Global Delivery Protocol Design

## Goal

Make routine work in every project move from a user request to a verified result with the fewest necessary turns. The protocol applies equally to Codex and Claude Code while preserving project rules and escalation for material risk.

## Decision

Adopt **fast path by default, escalation by evidence**. A narrow local task with a clear expected outcome proceeds directly to focused inspection, implementation, and the smallest relevant verification. It does not require a written plan, an agent, a worktree, a full test suite, or a confirmation merely because those mechanisms exist.

The existing shared workflows remain the canonical source. Claude Code receives them through the plugin; Codex receives installed copies. Claude Code's seven named agents remain Claude-native. Codex uses the same role contract through `agent-routing` templates and short-lived subagents; it does not import Claude agent markdown as an unsupported static registry.

## Task protocol

For each task, the primary agent maintains a compact task contract in the active conversation:

| Field | Rule |
|---|---|
| Outcome | Infer it from the request when unambiguous; do not ask the user to repeat it. |
| Scope | Start with named files, components, or project; expand only when evidence requires it. |
| Acceptance | Reuse explicit criteria; otherwise derive the smallest observable behavior or check. |
| Next action | State and perform one concrete next action in progress updates. |
| Handoff | Report changed files, commands actually run, open risks, and the next smallest action. |

This is task-local state, not a hidden cross-project database. Durable project facts are written only to the project's established documentation location and only with authorization.

## Routing rules

### Fast path — default

Use when the task is local, reversible, and has a bounded outcome. Read only the relevant instructions and files, edit directly, run targeted validation, and hand off. Do not create a plan, use a subagent, create a worktree, ask a procedural question, or run unrelated checks by default.

### Investigate or parallelize — evidence-based

Use one read-only agent only when exploration would materially delay the primary task or crowd its context. Use an isolated worktree only for concurrent edits, a risky change, or competing implementation paths. Use multiple agents only for independently owned files with a clear expected speedup. The primary agent remains responsible for synthesis and verification.

### Escalate — explicit risk boundary

Ask before secret handling, dependency installation, remote mutation, publishing, deployment, migration, CI/CD change, system-wide configuration, destructive action, or external coordination. Project-specific rules can require stricter handling.

## Cross-tool installation

The Codex global policy and documentation gain a managed fast-path section. The Claude global policy gains an equivalent managed section that explicitly takes precedence over legacy catalog advice to plan or delegate by default. Both installations preserve user text outside their marker blocks, have independent manifests, reject conflicts before writes, and verify checksums.

The source plugin version advances only after both targets are updated and tested. Installed version and source version must agree; a mismatch is a failed activation, not a cosmetic warning.

## Measurement and feedback

Every handoff records only lightweight delivery evidence: whether fast path or escalation was used, the concrete validation command, and any real blocker. The protocol treats repeated clarification, unneeded planning, unneeded delegation, and unrelated validation as defects to remove from the workflow.

No timer, telemetry service, background worker, or project-wide scanning is introduced. Initial success is verified with three representative fixtures: a narrow edit (fast path), unfamiliar-code question (read-only investigation), and an isolated concurrent edit (worktree). Both tools must show the intended route and preserve the required boundaries.

## Acceptance criteria

- The canonical policy explicitly says that routine bounded work proceeds without a plan, agent, worktree, or procedural confirmation.
- Claude Code and Codex receive equivalent fast-path and escalation semantics from managed source files.
- Existing user policy outside managed marker blocks is preserved byte-for-byte.
- Tests reject a foreign or drifted managed block and verify both tool manifests and installed versions.
- The agent-routing workflow defines a positive dispatch threshold rather than recommending delegation by default.
- Fixture tests demonstrate all three routes and document actual evidence rather than elapsed-time claims.

## Non-goals

- Replacing project instructions, platform gates, or explicit user approval requirements.
- Removing the legacy Claude agent catalog or automatically migrating third-party configuration.
- Persistent automatic memory across unrelated projects or sessions.
- Background agents, automatic network installs, automatic commits, pushes, releases, or destructive cleanup.
