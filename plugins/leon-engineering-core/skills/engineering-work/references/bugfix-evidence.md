# Bugfix Evidence

Reproduce the reported failure before editing. Keep a brief record of the actual failure; do not retain full failed trees, hashes or duplicate backups by default. Trace the narrowest root cause; separate adjacent weaknesses and avoid unrelated refactors.

Add or update the closest regression test, make the minimal fix and rerun the reproduction and focused checks under the common risk route. If reproduction is impossible, state the hypothesis and missing evidence instead of claiming a fix.

Use the relevant section of the shared [engineering methods reference](engineering-methods.md) for language diagnostics or regression tests; architecture judgment applies only when needed by the fix.

Correct or replace wrong results, then continue. Clean this task’s useless rebuildable temporary output; protect other work and business originals. Hand off root cause, changes, observed checks and actual missing results. Mandatory project gates still apply.
