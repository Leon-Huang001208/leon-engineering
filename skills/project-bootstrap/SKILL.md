---
name: project-bootstrap
description: Use when onboarding an unfamiliar repository or establishing its durable agent instructions, commands, logging, test, and CI expectations.
---

# Project Bootstrap

Inspect the repository before proposing rules. Identify its project instructions, architecture entry points, path-scoped rules, runtime and package managers, test and lint commands, CI workflows, and existing logging approach.

Record only verified facts with file paths and commands. Put project-specific requirements in project instructions, never in global policy. Propose missing rules separately; do not create or replace instructions without authorization.

End with the smallest onboarding checklist, open uncertainties, and the first safe validation command.

## Cross-project adapter

Treat the current repository as the only project in scope unless the user names another one. Read the global workflow entry point and then the repository's own instructions; the repository and path-scoped instructions override the global defaults. Keep the resulting profile task-local by default. Persist a project profile, agent rule, CI change, or template only when the user explicitly authorizes that repository change.
