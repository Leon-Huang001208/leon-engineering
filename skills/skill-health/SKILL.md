---
name: skill-health
description: Audit an agent skill catalog for ambiguous triggers, overlapping workflows, stale references, missing documentation, or unused high-context instructions. Use when adding, updating, retiring, or governing skills.
---

# Skill Health

Inspect each skill's name, description, body length, references, and documented owner. Keep descriptions trigger-focused. Flag collisions when two skills serve the same trigger without a routing distinction. Flag stale references when a file, command, agent, or tool no longer exists. Report additions, deprecations, and migrations separately. Never delete a skill without user approval.

## Lifecycle governance

For an external capability, record a separate lifecycle: discovery, source and permission vetting, user-approved installation, isolated validation, then evidence-based promotion or retirement. Do not install, trust, or network-fetch a skill automatically. Confirm that its documentation identifies the owner, trigger, boundaries, references, and the global or project layer that owns it; a project-specific workaround is not a global skill until it has repeated, reviewed evidence.
