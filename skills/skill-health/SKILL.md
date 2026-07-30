---
name: skill-health
description: Audit an agent skill catalog for ambiguous triggers, overlapping workflows, stale references, missing documentation, or unused high-context instructions. Use when adding, updating, retiring, or governing skills.
---

# Skill Health

Inspect each skill's name, description, body length, references, and documented owner. Keep descriptions trigger-focused. Flag collisions when two skills serve the same trigger without a routing distinction. Flag stale references when a file, command, agent, or tool no longer exists. Report additions, deprecations, and migrations separately. Never delete a skill without user approval.
