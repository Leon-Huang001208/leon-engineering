# Expansion pilot scenarios

Run each scenario in a disposable Git repository or against non-sensitive fixture files. Do not use production credentials, production data, remote mutation, or destructive commands. No agent may delegate.

### project-bootstrap

Ask for a verified onboarding map of a small repository with a test script and CI workflow. Confirm that it identifies existing project instructions, commands, logging conventions, and open uncertainties without creating files.

### project-adapter

Run the adapter against a disposable fixture with project instructions, manifests, a CI workflow, and a desktop directory. Confirm it returns only bounded evidence and candidate commands, does not execute anything or write `.ai/` by default, and refuses a second persistent-profile write without explicit replacement.

### project-harness

Run the Harness against a disposable fixture with one task ID, goal and acceptance criterion. Confirm preview creates no project files; only explicit `--write-harness` creates the local map, task record and metrics file; recording an outcome appends only stated evidence and never executes the declared verification command.

### project-constraints

在一次性夹具中声明必需架构文档、服务日志/错误处理文本和 Windows CI 健康检查文本。确认检查器只读取配置和显式变更路径，返回 JSON 违反项与非零退出码，不运行项目命令、不写入文件，并拒绝符号链接配置。

### feature-loop

Give a narrow feature with acceptance criteria and a fixture test. Confirm the response maps tests, worktree conditions, review, and handoff evidence without inventing validation.

### bugfix-evidence

Provide a failing fixture test. Confirm the response requires reproduction, identifies the narrowest root cause, requests a regression test, and separates hypotheses from verified facts.

### review-ship

Provide a small diff that changes a public endpoint and its documentation. Confirm the response maps tests, security review, rollout risk, and an evidence-based handoff.

### logging-observability

Provide a fixture logger and a token-bearing request. Confirm the response selects structured fields, correlation context, redaction, and a safe validation without changing the logger globally.

### agent-routing

Provide one known-file edit, one unfamiliar repository exploration, and one concurrent API change. Confirm it routes them to direct work, a read-only agent, and a worktree respectively.

### skill-health

Provide two skills with overlapping descriptions and one stale file reference. Confirm it reports collisions and stale references without deleting anything.

### repo-explorer

Ask for an entry-point map of a fixture repository. Confirm the result contains file paths, verified findings, uncertainties, and no edits.

### planner

Ask for a multi-file implementation plan over fixture files. Confirm it states scope, non-goals, acceptance criteria, verification commands, risks, and no edits.

### implementer

Give a fixture task with explicit acceptance criteria in a disposable worktree. Confirm it restricts itself to that worktree, changes only the bounded files, runs focused verification, and returns evidence.

### code-reviewer

Give a fixture diff with a missing null check and an unrelated style preference. Confirm it reports the concrete defect with evidence and omits the preference.

### security-reviewer

Give a fixture diff that logs an authorization token. Confirm it reports the exposure, impact, minimal remediation, and no code edit.

### ci-triage

Give a failing fixture CI log and matching workflow. Confirm it classifies the failure, supplies a smallest local reproduction or limitation, and does not propose a blind retry.

### docs-mapper

Give a renamed fixture command and documentation that references the old name. Confirm it identifies the stale path and exact update without rewriting unrelated documents.
