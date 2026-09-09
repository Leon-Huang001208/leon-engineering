---
name: iteration-delivery
description: Use when an implementation task in a Git project must be completed through an isolated branch, verified integration, remote default branch publication, CI, and safe cleanup.
---

# Iteration Delivery

For an implementation task in a user-selected Git project, use the managed controller at `$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs`. The normal lifecycle is `start` → implement and commit in the returned feature worktree → `prepare` → verify the merged result in the integration worktree → `publish` → poll `status` until CI is conclusive → `cleanup`.

Resolve the default branch from `origin/HEAD`; never assume `main` or `master`. A direct push is the default. If repository protection rejects it, the controller publishes the integration branch, creates a pull request, enables auto-merge, and waits for checks. This policy is already authorized as the user's standing delivery preference, so do not ask again whether to merge, push, or delete the completed branch.

Do not start automatic publication for an explicit `no-push`, local-only, draft, research, review, or read-only task. Project instructions and platform gates remain authoritative. Secrets, new dependencies, releases, migrations, and other separately controlled actions still require their own authorization.

If the remote default branch advances before publication, call `prepare` again. The controller preserves the stale integration commit in ancestry, rebuilds from the new remote base, and requires merged-result verification again. If a merge conflicts, resolve and commit it in the preserved integration worktree, then call `prepare` again before verification and publication.

CI failures may receive at most three evidence-based repair commits through `publish --repair`. After the third failure, use `rollback` only when the remote default tip is still exclusively owned by this delivery and the reverted result has passed verification. Otherwise preserve the branch and worktree and report the blocker.

Run `cleanup` only after CI is `passed` or explicitly `not_configured`. Cleanup refuses dirty worktrees, confirms the integration commit is in the remote default branch, removes managed worktrees, and deletes local and remote task branches. Never force-push, force-remove a dirty worktree, or force-delete an unmerged branch.

For Harness-managed implementation tasks, start the Harness record with `--delivery-required`, record real verification evidence, and finish with `harness-enforce.mjs --require-delivery`. The hard gate reads the receipt and verifies the live remote branch, CI, local branch, and worktree state; Harness itself does not run Git.
