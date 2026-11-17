# Bugfix Evidence

Reproduce the reported failure before editing. Record the command, input, observed result, and expected result. Trace the narrowest root cause; distinguish it from adjacent weaknesses and avoid unrelated refactors.

Write or update the closest regression test, make the minimal corrective change, and rerun the reproduction and focused test. If reproduction is impossible, state the hypothesis and the missing evidence instead of claiming a fix.

Use the [engineering methods reference](engineering-methods.md) for regression-test design; architecture judgment applies only when the fix requires an architecture change.

Hand off the root cause, changed files, verification output, unverified environments, and remaining risk.
