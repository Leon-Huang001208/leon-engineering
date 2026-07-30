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
