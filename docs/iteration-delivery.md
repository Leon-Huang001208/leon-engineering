# 实现性项目迭代闭环

`iteration-delivery` 是四档风险路由中的完整交付控制器，只作用于用户当前指定的 Git 项目，不扫描其他仓库。

## 四档路由

1. 只读快路径：批量读取，不建 worktree。
2. 窄小改本地环：仅限局部、可逆、无公开接口/schema/依赖/CI/数据库/桌面影响且无并发冲突；做本地验证、记录 Harness 结果，不发布、不伪造远端 receipt。
3. 中高风险隔离实现：在 worktree 中实现验证，默认不发布。
4. 明确发布/高风险完整交付：用户明确 ship，或涉及公开契约、schema、依赖、CI、数据库、安全、桌面/跨平台时使用完整链。

只有第 4 档使用 `--delivery-required` 与 `--require-delivery`。不能证明满足第 2 档全部条件时升级。

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

审核若在 `prepared` 后、发布前要求功能分支增加修复提交，使用 `--prepare --replace-prepared`。该操作不是普通重跑：receipt 必须仍为 `prepared`，功能和集成 worktree 必须干净，功能 HEAD 必须不同于已记录提交，远端默认分支必须仍等于 receipt 基线，旧集成提交不得已进入远端，并且 receipt 不得已有 CI run、PR、mode 或 remote commit。控制器在全部检查通过后才把旧 branch/worktree/commit 以 `superseded` 写入 `integrationHistory`、非强制移除旧集成 worktree，并创建下一编号 revision；任何条件失败都保留原 receipt 与 worktree。新 revision 必须重新运行合并结果验证。

```bash
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --prepare --replace-prepared --project /absolute/project --task-id task-id
```

CI 失败最多允许三次 `publish --repair`。三次仍失败时，只有直接推送模式、远端默认分支 tip 仍与本任务 receipt 完全一致，并且回滚结果已经验证通过，`rollback` 才能推送 revert。其他情况保留分支和 worktree，交给用户处理。任何阶段都不 force-push、不强删脏 worktree、不强删尚未进入默认分支的提交。

## 状态与硬门

无秘密状态以原子写入保存在 Git common dir：

- `.git/leon-engineering/deliveries/<task-id>.json`
- `.git/leon-engineering/logs/iteration-delivery.jsonl`

receipt 记录任务、远端、默认分支、功能/集成提交、`direct|pr` 模式、PR、CI、修复次数、回滚和清理状态。Harness 任务可声明 `delivery.required`；`harness-enforce --require-delivery` 读取 receipt 并实时确认远端包含交付提交、CI 合格、任务分支不存在、worktree 已删除。Harness 不执行 Git 写操作。

## 安装与验证

控制器随 Harness runtime 由 Codex 和 Claude 适配器安装。安装器测试必须覆盖临时 home 中的安装、幂等、漂移检测和用户配置保护；真实安装后分别运行两个适配器的 `--verify`。Codex 全局 Hook 更新后必须重启本地主机进程，新建任务本身不保证刷新宿主缓存；Claude 插件版本变更后，现有 Claude 会话需要重启才能加载新版本。
