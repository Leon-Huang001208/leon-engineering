---
name: project-harness
description: Use when a user-selected project needs work to survive across Codex or Claude sessions, with a task goal, acceptance criteria, handoff state, and delivery metrics.
---

# Project Harness

Use a repository-local Harness only for a user-selected project and task. It is a map and evidence ledger, not global memory and not a reason to inspect unrelated repositories.

Preview first; it must not write files:

```bash
node scripts/harness-project.mjs --project /absolute/project --task-id task-id --goal "Outcome" --acceptance "Observable result"
```

Only use `--write-harness` after the user has authorized writing task state to that exact project. It creates `.ai/harness/agent-map.md`, one task record, and `metrics.jsonl`; refuse to overwrite existing state.

At task completion, record only observed evidence. `--record-outcome` never runs its declared verification command; the executing agent must run validation separately before recording `passed`. Record the measured verification seconds. A blocked task also requires one standard blocker category: `environment`, `dependency`, `permission`, `requirements`, `test`, `external`, or `unknown`.

```bash
node scripts/harness-project.mjs --project /absolute/project --task-id task-id --record-outcome --status completed --clarification-rounds 0 --rework-count 0 --verification-command "npm test" --verification-status passed --verification-duration-seconds 18
```

To review a selected project's recorded delivery evidence, use the read-only evaluator. It does not create a Harness, write a report file, or run a task's declared command:

```bash
node scripts/harness-evaluate.mjs --project /absolute/project --format markdown
```

Report the sample size and verification-duration coverage with the metrics. Do not backfill historical durations or blocker categories from guesses. Use `project-adapter` before the Harness when the repository is unfamiliar. Do not store secrets, unexecuted results, private conversation content, or project facts in global policy.
