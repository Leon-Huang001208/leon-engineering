# Pilot results

**Date:** 2026-07-30

## Passed deterministic checks

- `claude plugin validate .claude-plugin/plugin.json` passed.
- The guard tests passed: destructive and credential actions deny; remote, dependency, and CI changes ask; normal local work allows.
- The audit test passed: events include only timestamp, lifecycle event, and tool name.
- A hook-shaped audit invocation created `/Users/leon/.claude/audit/events.jsonl` with mode `0600`; the recorded event contained no command, path, or token-derived text.
- The guard command emitted a valid `PreToolUse` allow response for `git status --short`.
- Both skill frontmatters parsed with the macOS Ruby YAML standard library and contain the required `name` and `description` fields.
- The plugin source uses small, locally committed changes; this document is updated after each pilot result.
- A complete, checksum-protected runtime snapshot exists at `/Users/leon/.claude/backups/engineering-framework-20260730-140935`.

## Runtime integration result: passed interactively

In disposable Git repositories, interactive Claude Code loaded `@leon-engineering:repo-explorer`. A `--bare` session that loaded only this plugin displayed both `leon-engineering` skills in its slash-command matcher: `agent-routing` and `skill-health`.

The guard command processed hook-shaped JSON and returned the expected decisions: `git status` and a routine source-file write allowed; `.env.local` denied; `git push` and `pip install` asked. This covers the same five pilot policy cases without exposing a real project to a write attempt.

Non-interactive `claude -p` requests still produced no output within 60 seconds, including the bare baseline. `claude auth status` reported a logged-in first-party OAuth session and direct HTTPS connectivity succeeded. Treat this as a separate CLI responsiveness issue, not as a framework activation blocker.

## Activation decision

`leon-engineering@leon-local` installed successfully with user scope and is enabled. `claude plugin details leon-engineering` reports two skills, two agents, and two hooks with an estimated always-on cost of 179 tokens.

The global policy is now active with medium default effort, a 160k compaction window, routine local engineering permissions, and explicit high-risk Bash denials. Retain the snapshot above until the two-week observation period has completed.

## Direct catalog expansion

**Date:** 2026-07-31

The user explicitly authorized advancing directly from the pilot to the complete initial catalog defined in the framework design. This adds five focused workflows (`project-bootstrap`, `feature-loop`, `bugfix-evidence`, `review-ship`, and `logging-observability`) and five bounded agents (`implementer`, `code-reviewer`, `security-reviewer`, `ci-triage`, and `docs-mapper`). It does not import or retire the broad legacy catalogs.

- `node --test tests/catalog.test.mjs tests/guard.test.mjs tests/audit.test.mjs` passed: 7 tests, 0 failures.
- `claude plugin validate .claude-plugin/plugin.json` passed and every JSON configuration parsed successfully.
- The catalog test confirms exactly seven skills and seven agents, explicit trigger/boundary metadata, no recursive delegation, worktree isolation for the implementer, and a non-production pilot scenario for every component.
- Source commit: `40b81e5 feat: expand engineering workflow catalog`.
- `claude plugin update leon-engineering@leon-local --scope user` updated the user-scope plugin from `0.1.0` to `0.2.0`. `claude plugin details leon-engineering@leon-local` reports seven skills, seven agents, and two hooks.

Claude Code must restart before the `0.2.0` catalog is loaded into a current session. The two-week audit observation remains useful for future tuning, but is no longer a prerequisite for this initial-catalog expansion.

## Fresh-process verification

**Date:** 2026-07-31

The installed cache at `/Users/leon/.claude/plugins/cache/leon-local/leon-engineering/0.2.0` passed all seven Node tests and manifest validation. `claude plugin details leon-engineering@leon-local` confirmed the installed `0.2.0` catalog has seven skills, seven agents, and two hooks.

A fresh non-interactive `repo-explorer` invocation against a disposable Git fixture did not return within approximately 60 seconds and was stopped. The fixture had no uncommitted changes. This reproduces the existing non-interactive CLI responsiveness issue; it does not demonstrate a catalog-loading failure and does not replace an interactive agent invocation after a Claude Code restart.

## Codex–Claude adapter validation

**Date:** 2026-07-31

- The source adapter passed `node --test tests/catalog.test.mjs tests/guard.test.mjs tests/audit.test.mjs tests/codex-adapter.test.mjs`: 11 tests, 0 failures. `claude plugin validate .claude-plugin/plugin.json` also passed.
- The Codex adapter installed all seven workflow directories to `/Users/leon/.codex/skills` with framework version `0.3.0` and source commit `cb35ffa`. Its manifest verification passed, the installed `agent-routing` reference contains the Codex role templates, and pre-existing `pdf` and `playwright` skills remained present.
- A fresh read-only `codex exec` request for `project-bootstrap` against a synthetic Git fixture produced no model answer after more than two minutes and was stopped. The fixture remained clean. This is a non-interactive Codex CLI responsiveness limitation, not a successful skill-discovery result.
- Native Codex subagent pilots did provide direct role evidence in the same synthetic fixture: `repo-explorer` returned the required repository findings with no parent diff; `implementer` changed only its dedicated child worktree, first reproduced the missing-default failure, then passed `node --test test/greet.test.js` with 2 tests. The parent checkout remained clean.
- `claude plugin update leon-engineering@leon-local --scope user` updated the user plugin from `0.2.0` to `0.3.0`. It was then enabled at user scope. `claude plugin details leon-engineering@leon-local` reports seven skills, seven named agents, and two hooks; the installed cache contains and validates the shared Codex role-template reference.

Restart Claude Code before using the updated plugin in an existing session. Codex global skills are already installed; a new Codex task sees the installed catalog, while the recorded non-interactive CLI limitation remains separate from its desktop-agent validation.

## Global project framework activation

**Date:** 2026-07-31

- `node --test tests/*.test.mjs` passed: 15 tests, 0 failures. `node --check scripts/install-codex-adapter.mjs`, `claude plugin validate .claude-plugin/plugin.json`, JSON manifest parsing, and `git diff --check` also passed before activation.
- Source commit `08fe70d feat: add global project framework` was installed. The source now owns a bounded policy block, six global workflow documents, and a separate global-framework manifest; the existing seven-skill manifest remains independent.
- The prior `/Users/leon/.codex/AGENTS.md` was copied to `/Users/leon/.codex/backups/global-project-framework-20260731/AGENTS.md.before` before installation. The installer preserved text outside its marker block.
- `node scripts/install-codex-adapter.mjs --install-global --codex-home /Users/leon/.codex` installed `GETTING_STARTED.md`, `STRUCTURE.md`, `COMMANDS_GUIDE.md`, `SKILLS_GUIDE.md`, `AGENTS_GUIDE.md`, and `SETTINGS_GUIDE.md`. Its immediate `--verify-global` result was `valid: true` with no drift.
- The standard skill adapter then installed and verified all seven shared workflows at framework version `0.4.0`; `--verify --target /Users/leon/.codex/skills` also returned `valid: true` with no drift. Existing non-framework skills remain outside the adapter's ownership.
- No repository below `/Users/leon/Desktop/Projects` was scanned, edited, committed, or pushed by this activation. Project-level instructions remain the higher-priority source of truth for every future task.

## Project adapter activation

**Date:** 2026-07-31

- The source profile-generator tests covered bounded evidence discovery, default read-only behavior, explicit persistence, overwrite refusal, unsafe-root rejection, malformed `package.json`, and CLI output. `node --test tests/*.test.mjs` passed: 21 tests, 0 failures.
- `node --check scripts/profile-project.mjs`, `git diff --check`, `claude plugin validate .claude-plugin/plugin.json`, and JSON parsing for both adapter manifests and the profile schema passed before activation.
- Source commit `48e5e97 docs: guide project adapter workflow` was installed as framework version `0.5.0`. The adapter now owns eight shared skills, including `project-adapter`; the global-document and skill manifests verified with `valid: true` and no drift.
- `project-adapter` was not run against any real project during this activation. No project profile, `.ai/` directory, project source, project configuration, repository history, remote, or CI configuration was created or changed.
- Future tasks may run the generator only for a user-selected project. Its normal mode is read-only; writing `.ai/project-profile.json` remains a separate explicit authorization and replacement remains opt-in.

## 高吞吐全局交付协议试运行

**日期：**2026-08-03

- 源码分支 `codex/high-throughput-delivery` 已完成源码验证：`node --test tests/*.test.mjs` 为 37/37 通过；`node --check scripts/install-codex-adapter.mjs`、`node --check scripts/install-claude-adapter.mjs`、`claude plugin validate .claude-plugin/plugin.json` 与 `git diff --check` 均通过。
- 在实际全局目录安装前，原文件已备份至 `/Users/leon/.codex/backups/high-throughput-20260803/AGENTS.md.before` 与 `/Users/leon/.codex/backups/high-throughput-20260803/CLAUDE.md.before`。随后安装并校验 Codex 全局策略、八个共享工作流和 Claude 受管策略；三项校验均返回 `valid: true`、零漂移，受管清单版本均为 `0.6.0`。
- 快路径夹具位于 `/tmp/leon-high-throughput-pilot-20260803`：主会话只改动 `src/greet.js` 与 `test/greet.test.js`，为已点名函数补充默认值 `World`，直接执行 `node --test test/greet.test.js`，结果 2/2 通过，并以 `git diff --check` 检查。该路径没有创建计划、代理或 worktree；改动随后作为夹具提交，父检出保持干净。
- 只读调研夹具：`repo-explorer` 仅读取同一夹具的 `README.md`、`src/greet.js` 与 `test/greet.test.js`，正确识别函数入口、默认值和 Node 内置测试入口；其未执行测试，明确标记该限制。之后以父检出的 `git diff --exit-code` 与空 `git status --short` 独立确认没有改动。
- 隔离实现夹具位于 `/tmp/leon-high-throughput-implementer-20260803`：`implementer` 只改动独立 worktree 中的 `src/greet.js` 与 `test/greet.test.js`，先复现空格输入返回 `Hello,  Leon ` 的失败，再以 `name.trim()` 完成最小修复。独立复核 `node --test test/greet.test.js` 为 3/3 通过、`git diff --check` 通过；父检出仍无未提交改动，执行者没有提交。
- 实施分支已快进合并至主分支。随后 `claude plugin update leon-engineering@leon-local --scope user` 已将用户级插件从 `0.3.0` 更新到 `0.6.0`；启用命令确认该插件原本已在用户范围启用。`claude plugin details leon-engineering@leon-local` 确认当前目录包含八个共享工作流、七个 Claude 命名代理和两个 hooks。已打开的 Claude Code 会话必须重启后才会载入新版本。
- 非交互式 `codex exec` 与 `claude -p` 未返回的既有响应性限制，继续只作为限制记录，不作为加载或试运行成功的证据。
