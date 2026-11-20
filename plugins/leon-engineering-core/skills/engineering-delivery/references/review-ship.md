# Review Ship

Review is read-only by default. Inventory the diff by behavior, contract, configuration, migration, dependency, documentation and generated artifact; map each group to required test, review and rollout evidence.

Inspect trust boundaries, authorization, input handling, secrets, remote effects, migrations, CI and platform constraints. Run only checks authorized by the task and label failed, omitted and unrun checks explicitly.

Report concrete findings by severity with file/line evidence and minimum remediation. If none are found, state that and the unverified areas; do not infer readiness from intent alone. Fixes need an authorized defect-repair route. Publication uses iteration-delivery with its existing gates and authorization.

## Language-specific risks

Use only checks relevant to the changed code and the project's supported environment. A style preference alone is not a blocking defect.

- C++: ownership, RAII, object lifetime, lock ordering and data races.
- Go: goroutine lifetime, context cancellation, channel ownership, races and error propagation.
- Flutter/Dart: asynchronous mounted checks, disposal, state transitions, loading/error states and accessibility semantics.
- Python: injection, unsafe deserialization, mutable defaults and resource handling; inspect the actual framework's authorization and transaction boundaries.
- Rust: unsafe invariants, ownership across boundaries, error propagation and blocking work inside async execution.

The handoff includes changed files, observed verification, failed and unattempted checks, blockers, rollback considerations and the next responsible action. Use the host's existing conversation/history and the project's handoff location; this does not create a parallel global session store.
