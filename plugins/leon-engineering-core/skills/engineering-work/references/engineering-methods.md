# Engineering methods within the existing workflow

This reference supplements the feature and defect modes of engineering-work; it is not another workflow. Read only the relevant section for language diagnostics, test design, bounded maintenance or an architecture decision within the accepted task. A small, clear task does not add a requirements interview or item-by-item approval. Reading this reference does not trigger a whole-repository scan, HTML report, or parallel agents. Existing authorization and project rules still apply.

## Test design

- Test primarily through agreed interfaces and assert observable behavior. Avoid unnecessary coupling to private functions, collaborator call order, or internal layout. An internal invariant can still need a focused test when that is the test's purpose.
- Derive expected results from the specification, known-good examples, or another independent basis. Do not recompute the expected result using the implementation's logic; establish why the test could disagree with an incorrect implementation.
- Mock or fake according to the test purpose: isolate an external dependency or force a failure when needed, and exercise real integration when that is the behavior being verified. Do not impose a blanket ban on mocks or treat mock behavior alone as product evidence.
- Test design supplements the project's mandatory contracts and verification routing. User prioritizing selected behaviors does not waive other required checks. The feature mode owns the smallest complete slice and test-before-change sequence; do not add a second loop here.
- Use coverage gaps to find missing behaviors and failure paths. Derive expected results independently before changing an assertion or accepting a golden image; use the project's thresholds rather than imposing a universal percentage.

## Relevant language checks

Use the project's existing toolchain, lockfile and registered commands. The following are candidates, not a requirement to run every tool, install missing dependencies or upgrade a toolchain.

| Affected code | Diagnosis and verification |
| --- | --- |
| C++ | Distinguish compilation from linking and CMake configuration failures. Use the project's build target and CTest/GoogleTest fixtures; use sanitizers or coverage tools when the changed behavior needs them. |
| Go | Separate build, vet/lint and test failures. Check cancellation and race behavior when concurrency changes; use the project's race-test command where supported. |
| Flutter/Dart | Separate analyzer, dependency and code-generation failures. Choose relevant unit/widget/golden/integration tests and inspect visual differences before accepting golden changes. |
| Gradle/Kotlin | Locate the failing module, configuration or compilation task. Check KMP source-set/expect-actual and generated-code boundaries; test coroutine behavior with controlled scheduling. |
| Rust | Follow the concrete compiler diagnostic through ownership and borrowing. Use the project's check/clippy/fmt/test commands as relevant; do not replace a failed conversion with an arbitrary default. |

## Bounded maintenance

- Before removing code, check dynamic entry points, public APIs, external consumers and configuration references. Remove a small verified set, run the affected checks and preserve concurrent edits; do not use a whole-file checkout as a general rollback.
- Derive documentation from actual manifests, schemas, routes and exports. Preserve hand-written content outside an authorized generated section. Keep code maps to verified entry points, call paths and system boundaries instead of duplicating the repository.
- For reusable knowledge, retain the concrete cause, evidence and reuse conditions. Git history and co-changes can suggest candidates but do not prove a rule. Check for an existing home, then absorb or discard; project facts stay with the project. Writing memory or installing a Skill still requires the task's authorization, and no parallel global session or instinct store is created.

## Architecture judgment

- Ask whether an abstraction concentrates complexity or merely adds forwarding, configuration, or understanding cost. Consider invariants, errors, compatibility and recovery as well as the interface shape. If the abstraction disappeared, would complexity disappear or spread back across callers? A thin module is not by itself a reason for deletion; a compatibility facade or host adapter may earn its place.
- Respect existing architecture decisions in the affected area. Reopening one requires a concrete problem and explicit trade-offs, including the cost of retaining and changing it. Use the project's existing decision documents; do not create another documentation hierarchy or expand the task into unrelated refactoring.

## Method source and license

The short language and maintenance checklist consolidates the retired source-command templates from the d27bb932 baseline. Old command names, missing ECC executors, fixed confirmation loops and unsafe fallback examples are not carried forward. The retirement map is maintained in `plugins/leon-engineering-commands/command-map.json`.

Method inspiration: Matt Pocock's [tdd](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md), [codebase-design](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md) and [improve-codebase-architecture](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md). This adaptation keeps only interface-based behavior tests, independent expected results, complexity-locality judgment and respect for decisions. Mandatory seam approval, external Skill calls, HTML output and parallel design sessions are not adopted.

Upstream main documents and MIT license were read on 2026-10-05. The reviewed local installation dates to 2026-05-10 and differs from current upstream text; its exact upstream commit is unknown. The installation folder hash is not an upstream commit. These links identify the method sources, not a pinned or verified installation version.

The MIT notice from [mattpocock/skills/LICENSE](https://github.com/mattpocock/skills/blob/main/LICENSE) is retained below for this adaptation:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
