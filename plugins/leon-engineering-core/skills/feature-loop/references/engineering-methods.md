# Engineering methods within the existing workflow

This reference supplements feature-loop and bugfix-evidence; it is not another workflow. Use it only for test design or an architecture decision needed by the accepted task. A small, clear task does not add a requirements interview or item-by-item approval. Reading this reference does not trigger a whole-repository scan, HTML report, or parallel agents. Existing authorization and project rules still apply.

## Test design

- Test primarily through agreed interfaces and assert observable behavior. Avoid unnecessary coupling to private functions, collaborator call order, or internal layout. An internal invariant can still need a focused test when that is the test's purpose.
- Derive expected results from the specification, known-good examples, or another independent basis. Do not recompute the expected result using the implementation's logic; establish why the test could disagree with an incorrect implementation.
- Mock or fake according to the test purpose: isolate an external dependency or force a failure when needed, and exercise real integration when that is the behavior being verified. Do not impose a blanket ban on mocks or treat mock behavior alone as product evidence.
- Test design supplements the project's mandatory contracts and verification routing. User prioritizing selected behaviors does not waive other required checks. The existing feature-loop owns the smallest complete slice and test-before-change sequence; do not add a second loop here.

## Architecture judgment

- Ask whether an abstraction concentrates complexity or merely adds forwarding, configuration, or understanding cost. Consider invariants, errors, compatibility and recovery as well as the interface shape. If the abstraction disappeared, would complexity disappear or spread back across callers? A thin module is not by itself a reason for deletion; a compatibility facade or host adapter may earn its place.
- Respect existing architecture decisions in the affected area. Reopening one requires a concrete problem and explicit trade-offs, including the cost of retaining and changing it. Use the project's existing decision documents; do not create another documentation hierarchy or expand the task into unrelated refactoring.

## Method source and license

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
