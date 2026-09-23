# Codex profile experiment

## Arms

1. Baseline: current enabled plugins, reasoning `high`.
2. Lean-only: eight low-frequency plugins disabled, reasoning `high`.
3. Lean-medium: the same lean plugin set, reasoning `medium`.

The candidate plugin set is `documents`, `spreadsheets`, `presentations`, `pdf`, `template-creator`, `visualize`, `browser-use`, and `record-and-replay`. Core engineering, GitHub, Superpowers, browser/computer-use foundations and Harness remain enabled.

## Fixed tasks

- Read-only: locate and explain one ResearchWorkbench verification route from a fixed commit.
- Local edit: one reversible documentation wording change with its planner-selected local gates.
- Framework routing: plan a known framework source change and verify architecture plus the three component tests are selected.
- Delivery: inspect one immutable receipt and decide whether cleanup is allowed, without creating a production change.

Run one sample per task per arm. Fix the order before starting and cross it as `baseline → lean-only → lean-medium`, `lean-medium → baseline → lean-only`, `lean-only → lean-medium → baseline`, then repeat the first order for the fourth task. Do not add samples after seeing results.

## Evidence schema

Each sample must validate through `validateExperimentManifest` and contain exactly:

- commit and prompt hash;
- model and reasoning;
- model-call and tool-call counts;
- input, cached input, non-cached input, output, reasoning and weighted usage;
- error count;
- `permissions: unchanged`;
- `gates: passed`;
- `qualityGrade: correct`.

## Promotion gate

Promote only when every answer/behavior is correct, permissions and required gates are unchanged, errors and tools do not worsen, and aggregate input, non-cached input and weighted usage each decline strictly. Static prompt bytes or a single cheap task cannot promote a profile.

The profile is preview-only before the required Codex host restart. Applying it requires a fresh exact diff preview and a private rollback receipt.
