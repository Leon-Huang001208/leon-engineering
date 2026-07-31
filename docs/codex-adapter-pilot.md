# Codex adapter pilot

Run every scenario in a disposable local Git repository containing only synthetic fixture files. Do not use production credentials, user data, remote repositories, package installation, destructive commands, or global configuration during runtime validation.

## Codex skill discovery

Start a fresh Codex invocation in a fixture repository and request `project-bootstrap`. A passing result names repository instructions, test command, logging convention, CI status, and one uncertainty. Record a timeout or missing skill as a limitation, not a passing result.

## Codex repo-explorer

Delegate the `repo-explorer` template from `agent-routing/references/codex-role-templates.md`. Verify the response contains the required evidence and both `git diff --exit-code` and `git status --short` in the fixture have no output.

## Codex implementer

Create a named child worktree for a one-line synthetic behavior change with a focused test. Delegate only the `implementer` template. Verify the test and diff in the child worktree; verify the parent checkout remains clean.

## Claude regression

Run the framework catalog, guard, audit, and adapter tests, then validate the Claude plugin manifest and inspect plugin details. The existing non-interactive Claude CLI timeout is a limitation and does not replace an interactive agent result.
