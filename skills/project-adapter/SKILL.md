---
name: project-adapter
description: Use when adapting the global engineering workflow to one user-selected unfamiliar project, before selecting implementation, verification, or delegation routes.
---

# Project Adapter

Generate a read-only project profile before relying on generic workflow assumptions:

```bash
node scripts/profile-project.mjs --project /absolute/project --format markdown
```

The profile reads a bounded set of conventional instruction, manifest, CI, and platform paths. It does not execute commands, recursively inspect source, read environment data, access the network, or prove that a candidate command has passed.

Read the actual project instructions and treat project- and path-scoped rules as higher priority than the profile or global policy. Use the profile's evidence and uncertainties to choose `project-bootstrap`, `agent-routing`, `feature-loop`, `bugfix-evidence`, `logging-observability`, or `review-ship`.

## Persistent project profiles

Only after the user explicitly authorizes writing to that exact project, use:

```bash
node scripts/profile-project.mjs --project /absolute/project --write-profile
```

This creates only `.ai/project-profile.json` and refuses an existing profile. Replacing it additionally requires `--replace-profile` and a review of the project diff. Do not treat a candidate command as executed evidence, and do not use this workflow to enumerate or modify other projects.
