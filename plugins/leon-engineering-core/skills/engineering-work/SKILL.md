---
name: engineering-work
description: Use when delivering a scoped feature or fixing a defect with reproducible verification.
---

# Engineering Work

### Defect

Follow [bugfix evidence](references/bugfix-evidence.md): reproduce the failure before editing, isolate the root cause, and verify the smallest fix with a regression check.

### Feature

Follow [feature delivery](references/feature-loop.md): agree on acceptance criteria and affected contracts, implement the smallest complete slice, and verify the result. Use an isolated worktree when project rules or concurrent changes require one.

Use the shared [engineering methods](references/engineering-methods.md) only for relevant language diagnostics, test design, bounded maintenance or architecture decisions. Project gates and the task's read-only or no-push boundary still apply; ordinary work does not select Harness.
