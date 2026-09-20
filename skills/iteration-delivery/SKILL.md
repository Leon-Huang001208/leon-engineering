---
name: iteration-delivery
description: Use when a Git task explicitly requires publication or has high-risk impact and must complete isolated integration, remote default branch publication, CI, and safe cleanup.
---

# Iteration Delivery

Classify work before invoking the controller:

- Read-only fast path: inspect directly and do not create a worktree.
- Narrow local edit: only when it is local, reversible, conflict-free, and has no public API/schema, dependency, CI, database, security, desktop, or cross-platform impact. Run focused local verification, record the Harness result without delivery flags, and do not publish or invent a remote receipt.
- Medium/high-risk isolated implementation: use an isolated worktree, but do not publish unless the task reaches the full-delivery tier.
- Explicit ship/high-risk full delivery: use the managed controller at `$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs` and the full lifecycle `start` → implement/commit → `prepare` → merged-result verification → `publish` → status/CI → `cleanup`.

Only the full-delivery tier starts Harness with `--delivery-required` and finishes with `harness-enforce.mjs --require-delivery`. Explicit publication or impact to public contracts, schema, dependencies, CI, databases, security, desktop/cross-platform behavior, or concurrent work requires this tier. When uncertain, upgrade the tier.

Resolve the default branch from `origin/HEAD`; never assume `main` or `master`. A direct push is the default. If repository protection rejects it, the controller publishes the integration branch, creates a pull request, enables auto-merge, and waits for checks. This policy is already authorized as the user's standing delivery preference, so do not ask again whether to merge, push, or delete the completed branch.

Do not publish an explicit `no-push`, local-only, draft, research, review, or read-only task. Project instructions and platform gates remain authoritative. Secrets, new dependencies, releases, migrations, and other separately controlled actions still require their own authorization.

If the remote default branch advances before publication, call `prepare` again. The controller preserves the stale integration commit in ancestry, rebuilds from the new remote base, and requires merged-result verification again. If a merge conflicts, resolve and commit it in the preserved integration worktree, then call `prepare` again before verification and publication.

CI failures may receive at most three evidence-based repair commits through `publish --repair`. After the third failure, use `rollback` only when the remote default tip is still exclusively owned by this delivery and the reverted result has passed verification. Otherwise preserve the branch and worktree and report the blocker.

Run `cleanup` only after CI is `passed` or explicitly `not_configured`. Cleanup refuses dirty worktrees, confirms the integration commit is in the remote default branch, removes managed worktrees, and deletes local and remote task branches. Never force-push, force-remove a dirty worktree, or force-delete an unmerged branch.

The full-delivery hard gate reads the real receipt and verifies the live remote default branch, CI, local branch, and worktree state; Harness itself does not run Git.
