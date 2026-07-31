# Codex–Claude Code Shared Framework Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the seven canonical `leon-engineering` workflows into Codex safely, provide bounded Codex role templates, and record independent Codex and Claude Code evidence.

**Architecture:** `skills/*/SKILL.md` remains the only maintained workflow text. A Node adapter copies these files into an explicit Codex target, writes a checksum manifest, refuses foreign conflicts, and can verify or rollback only what it owns. Claude Code continues to discover the same canonical skills and its existing named agents through the plugin.

**Tech Stack:** Node.js built-in modules and test runner, SHA-256, JSON, Markdown, Git worktrees, Codex CLI/Desktop, Claude Code plugin CLI.

---

## File map

| Path | Change | Responsibility |
|---|---|---|
| `scripts/install-codex-adapter.mjs` | Create | Parse adapter commands and safely copy, verify, and rollback Codex workflows. |
| `tests/codex-adapter.test.mjs` | Create | Exercise adapter behavior using isolated temporary targets. |
| `adapters/codex/manifest-schema.json` | Create | Document the adapter-owned manifest shape. |
| `skills/agent-routing/references/codex-role-templates.md` | Create | Provide bounded Codex delegation templates for all seven roles. |
| `skills/agent-routing/SKILL.md` | Modify | Route Codex delegation to the role templates without changing Claude behavior. |
| `docs/codex-adapter-pilot.md` | Create | Define non-sensitive Codex and Claude validation scenarios. |
| `docs/pilot-results.md` | Modify | Record actual adapter installation and runtime evidence. |
| `docs/superpowers/plans/2026-07-31-codex-claude-adapter.md` | Create | This implementation record. |
| `/Users/leon/.codex/AGENTS.md` | Modify last | Normalize the documented global skill location. |
| `/Users/leon/.codex/skills/*` | Modify last | Receive only adapter-owned workflow directories and manifest. |

### Task 1: Add failing Codex adapter behavior tests

**Files:**
- Create: `tests/codex-adapter.test.mjs`
- Reference: `tests/catalog.test.mjs`, `scripts/guard.mjs`, `skills/*/SKILL.md`

- [ ] **Step 1: Write the adapter contract test**

Create `tests/codex-adapter.test.mjs` with the following test structure. Use a temporary root for every test; never target `~/.codex` in a unit test.

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { install, verify, rollback, SKILL_NAMES } from "../scripts/install-codex-adapter.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function makeTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "leon-codex-adapter-"));
}

test("installs every canonical skill and writes a checksum manifest", () => {
  const target = makeTarget();
  const result = install({sourceRoot, targetRoot: target});
  assert.deepEqual(result.skills, SKILL_NAMES);
  assert.equal(verify({sourceRoot, targetRoot: target}).valid, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".leon-engineering.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.skills).sort(), SKILL_NAMES);
});

test("refuses to overwrite a foreign skill directory", () => {
  const target = makeTarget();
  fs.mkdirSync(path.join(target, "feature-loop"));
  fs.writeFileSync(path.join(target, "feature-loop", "SKILL.md"), "foreign");
  assert.throws(() => install({sourceRoot, targetRoot: target}), /foreign skill directory/);
  assert.equal(fs.readFileSync(path.join(target, "feature-loop", "SKILL.md"), "utf8"), "foreign");
});

test("detects drift and preserves unrelated skills during rollback", () => {
  const target = makeTarget();
  install({sourceRoot, targetRoot: target});
  fs.appendFileSync(path.join(target, "bugfix-evidence", "SKILL.md"), "\nchanged");
  assert.deepEqual(verify({sourceRoot, targetRoot: target}).drift, ["bugfix-evidence"]);
  fs.mkdirSync(path.join(target, "pdf"));
  fs.writeFileSync(path.join(target, "pdf", "SKILL.md"), "existing");
  rollback({targetRoot: target});
  assert.equal(fs.existsSync(path.join(target, "feature-loop")), false);
  assert.equal(fs.readFileSync(path.join(target, "pdf", "SKILL.md"), "utf8"), "existing");
});
```

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
node --test tests/codex-adapter.test.mjs
```

Expected: the test fails with `ERR_MODULE_NOT_FOUND` for `scripts/install-codex-adapter.mjs`; no target under `/Users/leon/.codex` is created or changed.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/codex-adapter.test.mjs
git commit -m "test: define Codex adapter contract"
```

### Task 2: Implement the safe adapter and make its tests green

**Files:**
- Create: `scripts/install-codex-adapter.mjs`
- Create: `adapters/codex/manifest-schema.json`
- Test: `tests/codex-adapter.test.mjs`

- [ ] **Step 1: Define the manifest schema**

Create `adapters/codex/manifest-schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "leon-engineering Codex adapter manifest",
  "type": "object",
  "required": ["schemaVersion", "adapter", "frameworkVersion", "sourceCommit", "skills"],
  "properties": {
    "schemaVersion": {"const": 1},
    "adapter": {"const": "leon-engineering"},
    "frameworkVersion": {"type": "string"},
    "sourceCommit": {"type": "string", "pattern": "^[0-9a-f]{7,64}$"},
    "skills": {
      "type": "object",
      "additionalProperties": {"type": "string", "pattern": "^[0-9a-f]{64}$"}
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Implement the adapter module**

Create `scripts/install-codex-adapter.mjs`. Export `SKILL_NAMES`, `install`, `verify`, and `rollback`; keep command parsing inside `main()` so the test can import the module without side effects.

```js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const manifestName = ".leon-engineering.json";
const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL_NAMES = [
  "agent-routing", "bugfix-evidence", "feature-loop", "logging-observability",
  "project-bootstrap", "review-ship", "skill-health"
];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonicalSkill(sourceRoot, name) {
  const file = path.join(sourceRoot, "skills", name, "SKILL.md");
  if (!fs.existsSync(file)) throw new Error(`missing canonical skill: ${name}`);
  return file;
}

function manifestPath(targetRoot) {
  return path.join(targetRoot, manifestName);
}

function readManifest(targetRoot) {
  const file = manifestPath(targetRoot);
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.adapter !== "leon-engineering" || manifest.schemaVersion !== 1) {
    throw new Error("invalid adapter manifest");
  }
  return manifest;
}

function sourceCommit(sourceRoot) {
  return execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
}

export function install({sourceRoot = sourceDirectory, targetRoot}) {
  if (!targetRoot) throw new Error("targetRoot is required");
  const existing = readManifest(targetRoot);
  fs.mkdirSync(targetRoot, {recursive: true});
  for (const name of SKILL_NAMES) {
    const target = path.join(targetRoot, name);
    if (fs.existsSync(target) && !existing?.skills?.[name]) {
      throw new Error(`foreign skill directory: ${name}`);
    }
  }
  const staging = fs.mkdtempSync(path.join(path.dirname(targetRoot), ".leon-engineering-stage-"));
  const skills = {};
  try {
    for (const name of SKILL_NAMES) {
      const source = canonicalSkill(sourceRoot, name);
      const destination = path.join(staging, name, "SKILL.md");
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.copyFileSync(source, destination);
      skills[name] = sha256(destination);
    }
    for (const name of SKILL_NAMES) {
      const target = path.join(targetRoot, name);
      fs.rmSync(target, {recursive: true, force: true});
      fs.renameSync(path.join(staging, name), target);
    }
    const plugin = JSON.parse(fs.readFileSync(path.join(sourceRoot, ".claude-plugin", "plugin.json"), "utf8"));
    const manifest = {
      schemaVersion: 1,
      adapter: "leon-engineering",
      frameworkVersion: plugin.version,
      sourceCommit: sourceCommit(sourceRoot),
      skills
    };
    fs.writeFileSync(`${manifestPath(targetRoot)}.tmp`, JSON.stringify(manifest, null, 2) + "\n", {mode: 0o600});
    fs.renameSync(`${manifestPath(targetRoot)}.tmp`, manifestPath(targetRoot));
    return {skills: SKILL_NAMES, manifest};
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

export function verify({sourceRoot = sourceDirectory, targetRoot}) {
  const manifest = readManifest(targetRoot);
  if (!manifest) throw new Error("adapter manifest not found");
  const drift = SKILL_NAMES.filter(name => {
    const source = canonicalSkill(sourceRoot, name);
    const installed = path.join(targetRoot, name, "SKILL.md");
    return !fs.existsSync(installed) || sha256(source) !== sha256(installed) || manifest.skills[name] !== sha256(installed);
  });
  return {valid: drift.length === 0, drift};
}

export function rollback({targetRoot}) {
  const manifest = readManifest(targetRoot);
  if (!manifest) throw new Error("adapter manifest not found");
  for (const name of Object.keys(manifest.skills)) {
    fs.rmSync(path.join(targetRoot, name), {recursive: true, force: true});
  }
  fs.rmSync(manifestPath(targetRoot), {force: true});
}

function main(args) {
  const targetIndex = args.indexOf("--target");
  if (targetIndex >= 0 && !args[targetIndex + 1]) throw new Error("--target requires a directory");
  const target = targetIndex >= 0
    ? args[targetIndex + 1]
    : path.join(process.env.HOME, ".codex", "skills");
  if (args.includes("--dry-run")) return console.log(JSON.stringify({targetRoot: target, skills: SKILL_NAMES}, null, 2));
  if (args.includes("--install")) return console.log(JSON.stringify(install({targetRoot: target}), null, 2));
  if (args.includes("--verify")) return console.log(JSON.stringify(verify({targetRoot: target}), null, 2));
  if (args.includes("--rollback")) return rollback({targetRoot: target});
  throw new Error("use --dry-run, --install, --verify, or --rollback");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
```

- [ ] **Step 3: Run the adapter tests and command-line checks**

Run:

```bash
node --test tests/codex-adapter.test.mjs
adapter_test_dir="$(mktemp -d)"
node scripts/install-codex-adapter.mjs --dry-run --target "$adapter_test_dir"
node scripts/install-codex-adapter.mjs --install --target "$adapter_test_dir"
node scripts/install-codex-adapter.mjs --verify --target "$adapter_test_dir"
node scripts/install-codex-adapter.mjs --rollback --target "$adapter_test_dir"
test ! -e "$adapter_test_dir/.leon-engineering.json"
```

Expected: all three tests pass; dry run performs no write; install and verify report all seven skills; rollback removes only adapter-owned files.

- [ ] **Step 4: Commit the adapter**

```bash
git add scripts/install-codex-adapter.mjs tests/codex-adapter.test.mjs adapters/codex/manifest-schema.json
git commit -m "feat: add Codex workflow adapter"
```

### Task 3: Add bounded Codex role templates and cross-tool pilot cases

**Files:**
- Create: `skills/agent-routing/references/codex-role-templates.md`
- Modify: `skills/agent-routing/SKILL.md`
- Create: `docs/codex-adapter-pilot.md`
- Test: `tests/catalog.test.mjs`

- [ ] **Step 1: Extend the catalog test with role-template assertions**

Add this test to `tests/catalog.test.mjs`:

```js
test("documents Codex role templates with explicit boundaries", () => {
  const source = fs.readFileSync(
    path.join(root, "skills", "agent-routing", "references", "codex-role-templates.md"),
    "utf8"
  );
  for (const name of Object.keys(agents)) assert.match(source, new RegExp(`## ${name}\\b`));
  assert.match(source, /Never create a nested agent/);
  assert.match(source, /parent checkout remains clean/);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --test tests/catalog.test.mjs
```

Expected: this new test fails because the Codex role-template reference is absent.

- [ ] **Step 3: Write the role templates**

Create `skills/agent-routing/references/codex-role-templates.md` with one `## <role>` section for each role. Each section must state the role, scope, prohibited actions, required output, and an invocation template. Use these boundaries:

```md
## repo-explorer

Use for unfamiliar-code exploration. Read only the delegated paths. Do not edit, install packages, run destructive commands, or delegate. Return entry points, execution flow, key files, verified findings, uncertainties, and the smallest next action.

Invocation: `Act as repo-explorer. Inspect only <paths>. Do not modify files or delegate. Return the specified evidence.`

## planner

Use for an evidence-based implementation plan. Read only. Do not edit or delegate. Return scope, non-goals, files, acceptance criteria, verification commands, risks, and order of work.

## implementer

Use only in a named isolated worktree. State acceptance criteria and allowed paths before editing. Do not touch the parent checkout, perform high-risk actions, or delegate. Return changed files, commands, results, and risks; prove the parent checkout remains clean.

## code-reviewer

Use for a bounded diff review. Read only. Report concrete severity-ranked findings with file paths and evidence; distinguish no findings from unverified areas.

## security-reviewer

Use for trust boundaries, secrets, injection, authorization, filesystem, and network effects. Read only. Report exploit preconditions, impact, evidence, and minimum remediation.

## ci-triage

Use for a failing CI log. Read only. Classify the failure, provide the smallest local reproduction or limitation, and never recommend an unexplained retry.

## docs-mapper

Use to locate documentation and instruction impact. Read only. Return required and optional updates separately, with stale statements, paths, and evidence.

Never create a nested agent. Escalate secret, destructive, dependency, remote mutation, release, migration, CI, and global-configuration actions. For `implementer`, the parent checkout remains clean.
```

Append to `skills/agent-routing/SKILL.md`:

```md
## Codex delegation

When using Codex subagents, read `references/codex-role-templates.md` and use exactly one role template. The prompt must name the role, scope, boundary, acceptance criteria, and evidence format. Verify the Git diff after a read-only role and the parent checkout after an implementer role.
```

Create `docs/codex-adapter-pilot.md` with one non-sensitive test for Codex skill discovery, one `repo-explorer` no-diff test, one `implementer` worktree-isolation test, and a Claude plugin-regression check. State that a non-interactive CLI timeout is a limitation, not a passing interactive-agent result.

- [ ] **Step 4: Run catalog tests and commit**

Run:

```bash
node --test tests/catalog.test.mjs
git add skills/agent-routing/SKILL.md skills/agent-routing/references/codex-role-templates.md docs/codex-adapter-pilot.md tests/catalog.test.mjs
git commit -m "docs: add Codex role templates"
```

Expected: all catalog tests pass and Claude retains the same seven skills and seven agents.

### Task 4: Install the adapter into Codex only after preflight checks

**Files:**
- Modify: `/Users/leon/.codex/AGENTS.md`
- Create: `/Users/leon/.codex/backups/leon-engineering-adapter-<timestamp>/AGENTS.md`
- Create: `/Users/leon/.codex/skills/.leon-engineering.json`
- Create: `/Users/leon/.codex/skills/<seven workflow directories>/SKILL.md`

- [ ] **Step 1: Read and back up the current Codex instruction file**

Run:

```bash
sed -n '1,240p' /Users/leon/.codex/AGENTS.md
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="/Users/leon/.codex/backups/leon-engineering-adapter-$timestamp"
mkdir -p "$backup_dir"
cp -a /Users/leon/.codex/AGENTS.md "$backup_dir/AGENTS.md"
shasum -a 256 "$backup_dir/AGENTS.md" > "$backup_dir/checksums.sha256"
```

Expected: current guidance is read before mutation; backup and checksum exist.

- [ ] **Step 2: Normalize only the skill path wording**

Replace the global skill-location line with:

```md
- 全局 Skill 目录: `/Users/leon/.codex/skills`
- 已安装的 `leon-engineering` 通用工作流位于该目录；项目规则优先于全局工作流。
```

Do not alter model providers, approval policy, MCP servers, environment variables, project trust, or any unrelated global rule.

- [ ] **Step 3: Preflight and install**

Run from the adapter worktree:

```bash
node scripts/install-codex-adapter.mjs --dry-run --target /Users/leon/.codex/skills
node scripts/install-codex-adapter.mjs --install --target /Users/leon/.codex/skills
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
```

Expected: dry run lists only the seven new workflow directories; install refuses conflict rather than overwriting `pdf` or `playwright`; verify reports `{"valid":true,"drift":[]}`.

- [ ] **Step 4: Prove rollback integrity without rolling back the active installation**

Run:

```bash
test -f /Users/leon/.codex/skills/.leon-engineering.json
test -d /Users/leon/.codex/skills/pdf
test -d /Users/leon/.codex/skills/playwright
backup_hash="$(awk '{print $1}' "$backup_dir/checksums.sha256")"
current_backup_hash="$(shasum -a 256 "$backup_dir/AGENTS.md" | awk '{print $1}')"
test "$backup_hash" = "$current_backup_hash"
```

Expected: only adapter-owned directories were installed, existing global skills remain, and the original AGENTS backup is intact.

### Task 5: Run independent Codex and Claude verification

**Files:**
- Create: temporary disposable Git fixtures only
- Modify: `docs/pilot-results.md`

- [ ] **Step 1: Create a non-sensitive Codex fixture**

Create a temporary Git repository containing `README.md`, `src/greet.js`, and `test/greet.test.js`; commit the fixtures. Do not include tokens, project source, user data, or remote configuration.

- [ ] **Step 2: Test a fresh Codex skill invocation**

Run:

```bash
codex exec --ephemeral --sandbox read-only -C "$fixture_dir" \
  "Use the project-bootstrap skill. Return the repository instructions, test command, logging convention, CI status, and one uncertainty. Do not modify files."
git -C "$fixture_dir" status --short
```

Expected: the response follows the bootstrap evidence format; Git status is empty. If Codex does not return or does not surface the skill, record that exact limitation without claiming discovery passed.

- [ ] **Step 3: Test the Codex `repo-explorer` template**

In a fresh Codex Desktop task, delegate the exact `repo-explorer` template to one subagent against the fixture. Verify:

```bash
git -C "$fixture_dir" diff --exit-code
git -C "$fixture_dir" status --short
```

Expected: the response identifies entry points, key files, uncertainty, and a next action; both Git commands return no output.

- [ ] **Step 4: Test the Codex `implementer` template**

Create a child worktree from the fixture. Delegate a one-line behavior change with an explicit test to the `implementer` template. Verify the child worktree contains the change and test result, while the parent has no diff:

```bash
git -C "$fixture_dir" worktree add "$fixture_worktree" -b fixture/implementer
git -C "$fixture_dir" status --short
git -C "$fixture_worktree" diff --check
node --test "$fixture_worktree/test/greet.test.js"
```

Expected: parent output is empty; child diff is valid; focused test passes. Stop for any request involving a secret, dependency, remote action, release, migration, CI, or global configuration.

- [ ] **Step 5: Re-run Claude plugin verification**

Run:

```bash
node --test tests/catalog.test.mjs tests/guard.test.mjs tests/audit.test.mjs tests/codex-adapter.test.mjs
claude plugin validate .claude-plugin/plugin.json
claude plugin details leon-engineering@leon-local
```

Expected: all tests pass; plugin details still report seven skills, seven agents, and two hooks. Do not substitute the known non-interactive Claude CLI timeout for a successful interactive test.

- [ ] **Step 6: Record evidence and commit**

Append to `docs/pilot-results.md`:

```md
## Codex adapter verification

Record the adapter version and source commit, actual Codex CLI outcome, `repo-explorer` parent-diff result, `implementer` parent/worktree results, checksums, Claude plugin details, and any timeout or interaction limitation. Never include a fixture path containing user data, command contents that could contain a secret, or credentials.
```

Then run:

```bash
git add docs/pilot-results.md
git commit -m "docs: record Codex adapter verification"
git status --short
```

Expected: the source worktree is clean and evidence distinguishes verified results from limitations.

### Task 6: Final scope and recovery verification

**Files:**
- Verify: all files in the file map
- Reference: `docs/2026-07-31-codex-claude-adapter-design.md`

- [ ] **Step 1: Verify approved source scope**

Run:

```bash
git diff --name-only 4291955..HEAD
git diff --check 4291955..HEAD
```

Expected: changes are limited to the Codex adapter, its tests, role-template reference, pilot documentation, and this plan; no legacy catalog deletion or Claude agent behavior change.

- [ ] **Step 2: Verify active Codex installation and rollback instructions**

Run:

```bash
node scripts/install-codex-adapter.mjs --verify --target /Users/leon/.codex/skills
node scripts/install-codex-adapter.mjs --dry-run --target /Users/leon/.codex/skills
```

Document this exact recovery procedure in `docs/pilot-results.md` without running it against the active installation:

```bash
node scripts/install-codex-adapter.mjs --rollback --target /Users/leon/.codex/skills
cp -a /Users/leon/.codex/backups/leon-engineering-adapter-<timestamp>/AGENTS.md /Users/leon/.codex/AGENTS.md
```

Expected: verify remains valid, dry run names only adapter-owned skills, and rollback is documented but not executed.

- [ ] **Step 3: Commit the plan record if it was not included with the implementation**

```bash
git add docs/superpowers/plans/2026-07-31-codex-claude-adapter.md
git commit -m "docs: add Codex adapter implementation plan"
```
