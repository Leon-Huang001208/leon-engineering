---
name: engineering-delivery
description: Use when reviewing a change, preparing a handoff, or performing an explicitly authorized release.
---

# Engineering Delivery

### Review and handoff

Follow [review and evidence](references/review-ship.md) to map the diff to tests, risks, and rollback evidence. Local review and preparation do not authorize remote operations.

### Publish only with current-task authorization

Follow the project's release or PR path. Read [managed delivery](references/iteration-delivery.md) only when project rules or the current task explicitly select that controller; remote authorization alone does not select a ledger. If the route is PR-only or unspecified, do not invoke a controller that attempts a direct push. Resolve the remote default branch, verify the integrated result, and clean up only when its requirements and authorization are satisfied.
