# 事件驱动开发产物清理

共用内核位于 `lib/resources/`，薄 CLI 为 `scripts/resource-lifecycle.mjs`。
它不运行定时任务、业务服务、模型或策略中的命令字符串。宿主账本固定在
`~/.agents/leon-engineering/resources/<hostname-sha256-prefix>/ledger.json`；不同设备不共享锁与删除权限。

## 接入与事件

框架源码、安装副本及宿主实际加载分别验收。全局安装须遵守项目明确授权边界；
受管安装使用现有 adapter 安装器，不能手工覆盖运行时。安装清单包含 CLI、内核和 v1 schema。
开启自动项目接入需要本机 `~/.agents/leon-engineering/resource-policy.json`：
`{"schemaVersion":1,"enabled":true}`。当前实现不替用户创建这个全局开关。
Codex Hook 更新后按宿主要求重启；Claude 现有会话也需要重新加载。

开启后真实 Harness Pre/Post 工具边界均可自动登记各项目的专属 observation 日志根并重查欠账；工具完成事件不依赖前置Hook是否已被宿主加载。
项目若已由交付桥先登记其他证据根，Hook仍幂等补齐安全日志根，不覆盖原根或导致后续观察登记失败。
只登记随后由 `runObserved` 生成的三份文件，不把已有目录中的未知文件纳入删除。
已验证的新fallback输出仅补登记该项目固定摘要目录，不纳管其中的历史未知文件；回归测试使用隔离HOME，避免用户启用策略后把测试夹具写入真实账本。
其他产物用 `enroll` 登记明确根，再在产物写入完成、仍属活动任务时 `register`；登记后内容变化会阻断删除。
Git worktree、BuildKit 对象由原生项目安全控制器处理，不能通过通用文件删除绕过。

CLI 接受 `enroll|register|event|preview|status|inventory`；写操作只接受结构化 JSON `--spec`，
可用 `--store` 指定隔离演练账本。`preview` 和 `status` 不写入；`inventory` 对指定路径只测量，
不登记、不删除。普通输出最多4096字节，完整状态留在私有账本。

```sh
node scripts/resource-lifecycle.mjs preview
node scripts/resource-lifecycle.mjs register --spec /absolute/registration.json
node scripts/resource-lifecycle.mjs event --spec /absolute/accepted-event.json
node scripts/resource-lifecycle.mjs inventory --spec /absolute/inventory-paths.json
```

登记输入含 `project,task,path,kind`；`kind` 为 temporary、evidence、safety-backup、deployment、cache。
deployment 还需 `target,revision`；`protection` 显式保留资源。
项目根及受管根自身不可作为待删资源；嵌套重复登记、符号链接、硬链接、Git目录和特殊文件拒绝。
根可显式扩展，不能通过重新接入撤销既有根；跨项目同路径只登记一次并保留全部使用者。

事件输入含 `project,task,type,proof`。proof 不是验证器：调用者必须先实际执行验证，再提交匹配记录。

| type | 前提与行为 |
| --- | --- |
| delivery-accepted | proof 为 `schemaVersion:1,task,revision,verification:"passed",source`；退休已释放的开发产物 |
| deployment-accepted | 同任务交付已通过且revision一致，另需 `target,health:"passed",generation`；generation由部署工具分配为目标内严格递增整数，每目标保留当前及上一成功版本 |
| task-retired | proof 为 `schemaVersion:1,task,source,disposition,uniqueWorkPreserved:true`；取消或已由成功任务替代，替代需successor |
| resume | 重查欠账；不改变任务交付或部署状态 |

共享交付控制器在原CI与远端包含检查之后发出交付事件；资源受阻时保留 `ci_passed` 和
`resourceCleanup.status=blocked`，不认证cleaned，可重入cleanup。没有部署成功证据不会淘汰部署版本。
项目部署工具必须在实际健康验收后发出deployment事件；本模块没有替代项目部署工具，也不会推断生产已部署。
每目标的generation高水位独立于摘要轮转永久保留一个整数；旧部署事件重放不提升为当前版本，失败和中断不等于退休。

## 有界保留与安全

任务产物由全部使用者释放后删除；缓存以宿主纳管对象合计20GiB为预算，按登记的最近使用顺序
回收空闲资源。工具管理的缓存经 `reportCache` 报告观测量及回执摘要，参与同一总预算，
内核不直接删除BuildKit的底层文件。报告是最近一次工具观测，不能当成持续实时测量；
未知或超限继续记欠账。未纳管的工具缓存不计为已受预算控制。

最小记录每项目默认100条、10MiB；活动/未解决资源及当前/上一部署版本的记录受保护，
超额由status明确报告。成功观察输出退休前保存校验摘要与seal；`readObservation`返回
`originalEvidence:"retired"`及摘要，不伪造完整原文。旧接口仍读取未纳管的完整证据。
正式交付文件、业务数据及秘密不属于该登记协议的可删分类。

写操作使用宿主锁；锁保存持有者PID、宿主及随机身份，只有能证明原持有者已退出时才恢复。
未知锁及活动进程不自动解锁。删除前后检查身份及macOS lsof占用，先持久化隔离位置，
再同父目录rename与核验删除；SIGKILL后的下一事件可恢复。使用者也应遵守资源登记/租约；
文件系统与lsof检查不能替代不合作进程的排他锁。其他平台删除占用检查保持unknown，须由本机适配验收。
通用CI先断言unknown会阻断并保留原件，再仅在隔离夹具注入idle验证退休算法；这不构成其他平台原生删除验收。
没有复制型清理备份；当前日志覆盖保存，删除记录摘要进入有界任务记录。

清理与交付状态分开；欠账保留，后续事件复查，状态未变化不重复通知。
存量先inventory、逐类批准并登记；特殊恢复/修复备份不因新策略自动解除保护。
容量报告区分逻辑字节、分配字节与宿主真实可用空间，APFS共享空间不承诺等量释放。
