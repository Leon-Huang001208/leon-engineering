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
