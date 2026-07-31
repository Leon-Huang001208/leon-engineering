# Project Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an evidence-based, default-read-only project adapter that profiles one user-selected repository and safely hands its verified facts to the shared engineering workflows.

**Architecture:** A standalone Node module reads only bounded conventional paths under `--project` and returns a stable `ProjectProfile`. A new focused skill explains how to use that profile. Optional persistence writes one atomically-created `.ai/project-profile.json`, never overwriting it without the explicit `--replace-profile` flag. The existing adapter installs the new eighth skill normally; global docs explain the contract.

**Tech Stack:** Node.js built-in modules and test runner, JSON Schema, Markdown, SHA-256 skill adapter, Git worktree.

---

## File map

| Path | Change | Responsibility |
|---|---|---|
| `scripts/profile-project.mjs` | Create | Bounded discovery, profile creation, formatting, explicit persistence, CLI, structured stderr logging. |
| `tests/project-profile.test.mjs` | Create | Real temporary-fixture coverage for profile facts, read-only default, persistence safeguards, and CLI output. |
| `adapters/codex/project-profile-schema.json` | Create | Machine-readable Profile contract. |
| `skills/project-adapter/SKILL.md` | Create | Trigger and safe use of the profile workflow. |
| `scripts/install-codex-adapter.mjs` | Modify | Add `project-adapter` as the eighth canonical skill. |
| `tests/catalog.test.mjs` | Modify | Assert exactly eight skills and the project-adapter contract. |
| `.claude-plugin/plugin.json` | Modify | Bump framework version to `0.5.0`. |
| `.claude-plugin/marketplace.json` | Modify | Keep marketplace version synchronized. |
| `adapters/codex/global-docs/*.md` | Modify | Explain profile generation, its read-only default, and project-rule precedence. |
| `docs/README.md`, `docs/pilot-results.md` | Modify | Index the plan and record actual checks and activation evidence. |

## Task 1: Specify profile behavior with a real temporary fixture (RED)

**Files:**
- Create: `tests/project-profile.test.mjs`
- Reference: `tests/codex-adapter.test.mjs`, `scripts/guard.mjs`

- [ ] **Step 1: Write fixture and module-contract tests**

Create a fixture with the following actual files: `AGENTS.md`, `docs/ARCHITECTURE.md`, `package.json` with `test`, `lint`, and `build` scripts, `pyproject.toml`, `src-tauri/`, and `.github/workflows/ci.yml`. Import the future API:

```js
import {
  buildProfile,
  formatMarkdown,
  writeProfile,
  PROFILE_FILENAME
} from "../scripts/profile-project.mjs";

test("builds evidence from bounded project files without writing", t => {
  const project = makeFixture(t);
  const profile = buildProfile({projectRoot: project});
  assert.equal(profile.schemaVersion, 1);
  assert.deepEqual(profile.instructions.map(item => item.path), [
    "AGENTS.md", "docs/ARCHITECTURE.md"
  ]);
  assert.deepEqual(profile.commands, [
    {kind: "build", command: "npm run build", source: "package.json", status: "candidate"},
    {kind: "lint", command: "npm run lint", source: "package.json", status: "candidate"},
    {kind: "test", command: "npm test", source: "package.json", status: "candidate"}
  ]);
  assert.equal(fs.existsSync(path.join(project, ".ai")), false);
  assert.match(formatMarkdown(profile), /Candidate validation commands/);
});
```

- [ ] **Step 2: Add persistence and rejection tests**

Add tests that `writeProfile({projectRoot, profile})` creates only `path.join(projectRoot, ".ai", PROFILE_FILENAME)`, a second call throws `/existing project profile/`, `replace: true` replaces it, and the function rejects the home directory and root directory. Add a CLI test with `spawnSync(process.execPath, [script, "--project", project, "--format", "json"])` that confirms exit status `0`, parseable JSON, and no `.ai` directory.

- [ ] **Step 3: Run the new test and confirm RED**

Run:

```bash
node --test tests/project-profile.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` because `scripts/profile-project.mjs` does not yet exist. No source file is implemented before this expected failure is observed.

- [ ] **Step 4: Commit the red contract**

```bash
git add tests/project-profile.test.mjs
git commit -m "test: define project profile contract"
```

## Task 2: Build the read-only profile generator and safe writer (GREEN)

**Files:**
- Create: `scripts/profile-project.mjs`
- Test: `tests/project-profile.test.mjs`

- [ ] **Step 1: Implement deterministic bounded discovery**

Export `PROFILE_FILENAME = "project-profile.json"` and `buildProfile({projectRoot})`. Resolve `projectRoot`, reject non-directories, `/`, and `os.homedir()`. Read only these relative candidates: `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_MAP.md`, `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `src-tauri`, `Dockerfile`, and direct regular files under `.github/workflows/` ending in `.yml` or `.yaml`.

Use this profile shape exactly:

```js
{
  schemaVersion: 1,
  projectRoot: resolvedRoot,
  instructions: [{path, kind}],
  ecosystems: [{kind, evidence: [path]}],
  commands: [{kind, command, source, status: "candidate"}],
  ci: [{path, kind: "workflow"}],
  platformSignals: [{kind, path}],
  evidence: [{path, kind}],
  uncertainties: ["Candidate commands have not been executed."]
}
```

Parse only `package.json`; invalid JSON throws `invalid package.json`. Sort every collection by `path`, then `kind`, then `command`, so test output is stable. Convert only `scripts.build`, `scripts.lint`, and `scripts.test` into `npm run build`, `npm run lint`, and `npm test` candidates.

- [ ] **Step 2: Implement output and guarded persistence**

Export `formatMarkdown(profile)` and `writeProfile({projectRoot, profile, replace = false})`. Markdown must label commands as candidates and list uncertainties. `writeProfile` resolves `.ai/project-profile.json`, proves it remains beneath `projectRoot`, creates `.ai` only at write time, rejects an existing profile unless `replace` is true, and writes JSON through a same-directory random temporary file followed by `renameSync`.

Write a local `log(event, details = {})` that emits JSON to stderr with `{component: "project-profile", event, ...details}`. Log only safe counts, format choice, and lifecycle outcome; do not log file contents, environment values, or command output. Wrap CLI execution in `try/catch`, log `command_failed` with the error message, and set `process.exitCode = 1`.

- [ ] **Step 3: Implement the CLI**

Require `--project <directory>`; accept `--format json|markdown`, `--write-profile`, and `--replace-profile`. Reject an absent option value, an unknown format, `--replace-profile` without `--write-profile`, and extra write flags that are not recognized. The default outputs JSON to stdout and must make no write. `--write-profile` is an explicit write request, performs `writeProfile`, then prints the selected output format.

- [ ] **Step 4: Run GREEN tests**

Run:

```bash
node --test tests/project-profile.test.mjs
node --check scripts/profile-project.mjs
```

Expected: all project-profile tests pass and the script has no syntax error.

- [ ] **Step 5: Commit the generator**

```bash
git add scripts/profile-project.mjs tests/project-profile.test.mjs
git commit -m "feat: add read-only project profile generator"
```

## Task 3: Add the project-adapter skill and catalog integration

**Files:**
- Create: `skills/project-adapter/SKILL.md`
- Create: `adapters/codex/project-profile-schema.json`
- Modify: `scripts/install-codex-adapter.mjs`, `tests/catalog.test.mjs`
- Modify: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: Extend catalog expectations first**

Add `project-adapter` to the `skills` map in `tests/catalog.test.mjs` with phrases `"read-only"` and `"candidate"`. Add an assertion that `adapters/codex/project-profile-schema.json` parses and requires `schemaVersion`, `projectRoot`, `instructions`, `ecosystems`, `commands`, `ci`, `platformSignals`, `evidence`, and `uncertainties`. Run:

```bash
node --test tests/catalog.test.mjs
```

Expected: failure because the eighth skill and schema are absent.

- [ ] **Step 2: Add the schema and focused skill**

Use JSON Schema draft 2020-12. Require `schemaVersion: 1`, string `projectRoot`, arrays for all profile collections, and command objects whose `status` is `candidate`. The skill frontmatter must use:

```yaml
name: project-adapter
description: Use when adapting the global engineering workflow to one user-selected unfamiliar project, before selecting implementation, verification, or delegation routes.
```

Its body must require project-local instruction reading, explain that the generator does not run commands, require user authorization before `--write-profile`, reject treating candidates as successful checks, and hand off to `project-bootstrap`, `agent-routing`, and the work-specific skills.

- [ ] **Step 3: Add the eighth adapter-owned skill**

Append `"project-adapter"` to `SKILL_NAMES` in `scripts/install-codex-adapter.mjs`; do not otherwise relax manifest ownership checks. Bump both plugin version fields from `0.4.0` to `0.5.0`.

- [ ] **Step 4: Run catalog and adapter checks**

Run:

```bash
node --test tests/catalog.test.mjs tests/codex-adapter.test.mjs
claude plugin validate .claude-plugin/plugin.json
```

Expected: catalog recognizes eight focused skills, the adapter installs all eight into a temporary target, and the plugin manifest validates.

- [ ] **Step 5: Commit catalog integration**

```bash
git add skills/project-adapter/SKILL.md adapters/codex/project-profile-schema.json \
  scripts/install-codex-adapter.mjs tests/catalog.test.mjs \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat: add project adapter workflow"
```

## Task 4: Document, verify, and activate the global update

**Files:**
- Modify: `adapters/codex/global-docs/GETTING_STARTED.md`
- Modify: `adapters/codex/global-docs/COMMANDS_GUIDE.md`
- Modify: `adapters/codex/global-docs/SKILLS_GUIDE.md`
- Modify: `adapters/codex/global-docs/AGENTS_GUIDE.md`
- Modify: `docs/README.md`, `docs/pilot-results.md`

- [ ] **Step 1: Update global documentation**

Document the `project-adapter` trigger, its read-only command, candidate-command semantics, and opt-in `.ai/project-profile.json` write. State that framework installation does not profile projects. Add this plan to `docs/README.md`.

- [ ] **Step 2: Run complete source validation**

Run:

```bash
git diff --check
node --check scripts/profile-project.mjs
node --test tests/*.test.mjs
claude plugin validate .claude-plugin/plugin.json
node -e 'for (const file of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "adapters/codex/manifest-schema.json", "adapters/codex/project-profile-schema.json"]) JSON.parse(require("node:fs").readFileSync(file, "utf8")); console.log("json manifests parse")'
```

Expected: clean diff, syntax success, all tests pass, plugin validates, and every JSON document parses.

- [ ] **Step 3: Activate only the framework installation**

After source tests pass, run:

```bash
node scripts/install-codex-adapter.mjs --install-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --verify-global --codex-home /Users/leon/.codex
node scripts/install-codex-adapter.mjs --install --target /Users/leon/.codex/skills
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
```

Expected: both verifiers report `valid: true` with no drift. Do not invoke `profile-project.mjs` against any real user project as part of activation.

- [ ] **Step 4: Record evidence and commit documentation**

Add exact executed commands, test counts, manifest-verification results, source commit, and the statement that no project was profiled or changed to `docs/pilot-results.md`. Then run `git diff --check`, commit the documentation, and leave the branch clean.

```bash
git add adapters/codex/global-docs docs/README.md docs/pilot-results.md
git commit -m "docs: record project adapter activation"
```

## Plan self-review

- The plan covers the approved read-only generator, explicit persistence, skill routing, adapter integration, documentation, and production activation.
- All new exported behavior is introduced test-first; existing adapter behavior remains covered by its regression tests.
- Persistence has a precise opt-in path, overwrite guard, root/home protection, atomic write, and error behavior.
- No task scans configured projects, uses network access, installs dependencies, or modifies a user project during framework activation.
