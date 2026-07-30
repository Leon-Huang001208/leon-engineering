# Pilot results

**Date:** 2026-07-30

## Passed deterministic checks

- `claude plugin validate .claude-plugin/plugin.json` passed.
- The guard tests passed: destructive and credential actions deny; remote, dependency, and CI changes ask; normal local work allows.
- The audit test passed: events include only timestamp, lifecycle event, and tool name.
- The guard command emitted a valid `PreToolUse` allow response for `git status --short`.
- Both skill frontmatters parsed with the macOS Ruby YAML standard library and contain the required `name` and `description` fields.
- The plugin source has four local commits and a clean worktree before this evidence file.
- A complete, checksum-protected runtime snapshot exists at `/Users/leon/.claude/backups/engineering-framework-20260730-140935`.

## Runtime integration result: blocked

In a disposable Git repository, each of the following non-interactive CLI requests produced no output within 60 seconds and was stopped:

1. A bare baseline request with no plugin and no tools.
2. A bare request loading this plugin and selecting `repo-explorer` with no tools.

`claude auth status` reported a logged-in first-party OAuth session. Direct HTTPS connectivity to the Anthropic API and Claude web endpoint also succeeded. The stalled baseline therefore precedes plugin, skill, agent, and hook execution; it is not evidence of a framework defect.

## Activation decision

Do not modify `/Users/leon/.claude/CLAUDE.md` or `/Users/leon/.claude/settings.json`, and do not install the plugin, until an interactive or non-interactive Claude CLI request completes successfully. This preserves the pre-existing global runtime unchanged.

## Next verification command

Run this from a trusted terminal after resolving the baseline CLI stall, then complete the checks in `docs/pilot.md`:

```bash
pilot_dir="$(mktemp -d)"
git -C "$pilot_dir" init
cd "$pilot_dir"
claude --plugin-dir /Users/leon/Developer/claude-engineering --agent repo-explorer -p "Reply with exactly PILOT_AGENT_OK."
```
