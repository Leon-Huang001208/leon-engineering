---
name: bugfix-evidence
description: Use when correcting a regression or defect that needs a reproduced failure, narrow root-cause analysis, minimal fix, and verified evidence.
---

# Bugfix Evidence

Reproduce the reported failure before editing. Record the command, input, observed result, and expected result. Trace the narrowest root cause; distinguish it from adjacent weaknesses and avoid unrelated refactors.

Write or update the closest regression test, make the minimal corrective change, and rerun the reproduction and focused test. If reproduction is impossible, state the hypothesis and the missing evidence instead of claiming a fix.

Hand off the root cause, changed files, verification output, unverified environments, and remaining risk.
