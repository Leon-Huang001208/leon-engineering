# 实现性项目迭代闭环

`iteration-delivery` 把用户已经确认的长期交付偏好固化在 `leon-engineering` 受管框架中，而不是依赖聊天记忆。它只作用于用户当前明确指定的 Git 项目，不扫描或批量修改其他仓库。

## 默认流程

1. `start` 读取 `origin/HEAD`，同步最新默认分支，并创建 `codex/<task-id>-<slug>` 与隔离功能 worktree。
2. 执行者在功能 worktree 实现、测试并提交。
3. `prepare` 获取任务锁，从最新远端默认分支创建临时集成 worktree，以 `--no-ff` 合并功能分支。
4. 执行者在集成 worktree 运行与风险相称的真实验证，并把命令、通过状态和实测耗时交给 `publish`。
5. `publish` 再次确认远端未并发推进。优先直推默认分支；若 GitHub 分支保护拒绝，则推送集成分支、创建 PR、启用自动合并并等待检查。
6. `status` 查询 CI。没有任何 Actions workflow 时记录 `not_configured`，不能把“暂时没有 run”误判为未配置。
7. `cleanup` 只在交付提交已包含于远端默认分支、CI 为 `passed` 或 `not_configured` 且 worktree 干净时，删除本地/远端任务分支和临时 worktree。

显式 `no-push`、仅本地、草稿、调研、评审和只读任务不进入自动发布。项目级规则、原生平台验证、秘密、新依赖、正式发布和迁移等独立授权边界仍然有效。

## 并发、冲突与失败

远端在 `prepare` 后推进时，`publish` 把 receipt 标为 `remote_moved` 并拒绝发布。再次运行 `prepare` 会保留旧集成提交的祖先关系，从新远端基线重建集成结果；新的结果必须重新验证。

合并冲突时保留集成 worktree。解决冲突并提交后再次运行 `prepare`，控制器确认无未解决冲突且 worktree 干净，再进入 `prepared`。

CI 失败最多允许三次 `publish --repair`。三次仍失败时，只有直接推送模式、远端默认分支 tip 仍与本任务 receipt 完全一致，并且回滚结果已经验证通过，`rollback` 才能推送 revert。其他情况保留分支和 worktree，交给用户处理。任何阶段都不 force-push、不强删脏 worktree、不强删尚未进入默认分支的提交。

## 状态与硬门

无秘密状态以原子写入保存在 Git common dir：

- `.git/leon-engineering/deliveries/<task-id>.json`
- `.git/leon-engineering/logs/iteration-delivery.jsonl`

receipt 记录任务、远端、默认分支、功能/集成提交、`direct|pr` 模式、PR、CI、修复次数、回滚和清理状态。Harness 任务可声明 `delivery.required`；`harness-enforce --require-delivery` 读取 receipt 并实时确认远端包含交付提交、CI 合格、任务分支不存在、worktree 已删除。Harness 不执行 Git 写操作。

## 安装与验证

控制器随 Harness runtime 由 Codex 和 Claude 适配器安装。安装器测试必须覆盖临时 home 中的安装、幂等、漂移检测和用户配置保护；真实安装后分别运行两个适配器的 `--verify`。Claude 插件版本变更后，现有 Claude 会话需要重启才能加载新版本。
