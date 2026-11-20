# Defect repair

Reproduce the reported failure before editing. Record input, command, observed and expected results. Trace the narrowest root cause; separate adjacent weaknesses and avoid unrelated refactors.

Add or update the closest regression test, make the minimal fix and rerun the reproduction and focused checks under the common risk route. If reproduction is impossible, state the hypothesis and missing evidence instead of claiming a fix.

Use the shared [engineering methods reference](../../feature-loop/references/engineering-methods.md) for relevant regression tests; architecture judgment applies only when needed by the fix.

Hand off root cause, changed files, real verification, unverified environments and remaining risks. Mandatory project gates still apply.
