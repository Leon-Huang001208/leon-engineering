# Codex adapter pilot

当前默认安装仅含短规则和按需指南，不注册 Hook 或自动部署 Harness runtime。下文保留宿主验证方式；历史 Hook/guard 检查不能当成当前自动启用要求。现行命令见 `adapters/codex/global-docs/COMMANDS_GUIDE.md`。

旧 Hook 只在归属与校验和匹配时备份退休。若后续指南安装失败，本次移除的 Hook 从已校验备份恢复；恢复不覆盖后来创建的文件。恢复无法完成时，错误与结构化日志保留备份位置，安装不得记为成功。

Run every scenario in a disposable local Git repository containing only synthetic fixture files. Do not use production credentials, user data, remote repositories, package installation, destructive commands, or global configuration during runtime validation.

## Codex skill discovery

Start a fresh Codex invocation in a fixture repository and request `project-onboarding`. A passing result names repository instructions, test command, logging convention, CI status, and one uncertainty. Record a timeout or missing skill as a limitation, not a passing result.

## Codex repo-explorer

Delegate the `repo-explorer` template from `agent-routing/references/codex-role-templates.md`. Verify the response contains the required evidence and both `git diff --exit-code` and `git status --short` in the fixture have no output.

## Codex implementer

Create a named child worktree for a one-line synthetic behavior change with a focused test. Delegate only the `implementer` template. Verify the test and diff in the child worktree; verify the parent checkout remains clean.

## Claude regression

Run the framework catalog, guard, audit, and adapter tests, then validate the Claude plugin manifest and inspect plugin details. The existing non-interactive Claude CLI timeout is a limitation and does not replace an interactive agent result.
