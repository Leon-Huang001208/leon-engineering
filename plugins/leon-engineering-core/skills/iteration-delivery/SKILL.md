---
name: iteration-delivery
description: Use when project rules or the current task explicitly select the managed Git delivery controller, including its integration, publication, CI and cleanup receipts.
---

# Iteration Delivery

Start from current task authorization and the selected project's delivery policy. High risk requires appropriate checks and isolation; it does not itself authorize publication or select a ledger. Ordinary local edits use focused project checks without Harness records or delivery flags.

Use the project's existing release or PR entrypoint unless the project or task explicitly selects this managed controller. The controller attempts a direct push before falling back to a PR; do not invoke publication when that behavior conflicts with a PR-only or no-push boundary. Never infer standing merge or deletion authorization from this Skill.

For an explicitly selected managed delivery, verify the optional runtime and use `start` → implement → `prepare` → verify merged result → authorized `publish` → CI/status → safe `cleanup`. Only this selected flow uses Harness `--delivery-required` and `harness-enforce.mjs --require-delivery`; flags do not grant remote or release permission.

Resolve the remote default branch rather than assuming main/master. If it advances, prepare a new integration and repeat the checks affected by that change. Fix conflicts in the preserved worktree. When a prepared but unpublished candidate changes, use the controller's `--prepare --replace-prepared` checks; never publish an obsolete result to avoid those checks.

Preserve the selected project's fixed contracts, actual CI and platform gates. Missing evidence stays NOT_RUN/BLOCKED. CI repair and rollback use the existing bounded controller checks; rollback requires exclusively owned remote state and verification of the reverted result. Do not silently waive a required check or claim deployment from a merge.

Cleanup only after CI is passed or explicitly not_configured, the integration is proven in the remote default branch, and worktrees are clean. Never force-push, force-remove dirty worktrees or delete unmerged work. Project resource registration and retirement apply only when that lifecycle policy was explicitly enabled; preserve active data, dependencies and recovery evidence.

Commands and receipt recovery details remain in the selected source's `docs/iteration-delivery.md`. Manual runtime tools are optional; the project retains ownership of business acceptance and publication policy.
