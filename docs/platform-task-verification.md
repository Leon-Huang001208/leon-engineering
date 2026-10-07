# 平台任务验收协议

Verification 的显式 task 模式只规划和校验，不运行测试、安装、CI 或发布。无 task 保持原 plan3/receipt2 与归档兼容语义；有 task 使用 plan4/receipt3，不能给旧回执补造 runner 或宿主 PASS。

## Task 与绑定

任务输入包含 hostPlatform（macos/linux/windows）、taskKind（feature-development/platform-adaptation）、objective、acceptanceScope、candidateCommit、candidateBaseCommit、supplementalGateIds。项目拥有功能/适配平台职责，通用内核不硬编码某项目的 Mac 开发限制。

CLI 的 --task-context 只读取安全项目相对 JSON，且要求 --base。上下文进入 Git-bound plan 的 canonical 重建与哈希；完整 committed/staged/unstaged/untracked changed set 保留。未绑定预览不能认证 hostAcceptance；有未提交字节时不能用候选 commit 的 CI 认证它。

补充门禁只接受 policy 已登记的稳定 ID，累积到完整验收闭包并保持必要深度，不接受任意命令。规划不会 dispatch 或执行配置命令。

## 结果与证据

- hostAcceptance 从本宿主 local、同平台 CI、要求的真机证据推导；其他平台 FAIL/NOT_RUN 留在交接及整体风险，不伪装成当前宿主结果。
- platformHandoffs 是真实其他目标及门禁状态。cross-platform 的未覆盖原生目标为 NOT_RUN；generic 单独不推断所有 OS。
- aggregateAcceptance 只有全部目标与门禁都有有效证据才 READY；本宿主 PASS 可以同时 NOT_READY。
- mergeReady/releaseReady 仍取完整必要门禁，不能从 hostAcceptance PASS 推导跨平台发布。

local 项须 runnerPlatform；CI PASS 须 runnerPlatform、runId、workflow、candidateCommit、checkoutCommit、expectedCheckoutCommit、checkoutKind。workflow 与已登记 gate 对应，runner 必须匹配唯一原生目标；一个 runner 不证明多个 OS。

checkoutKind 区分 candidate-head、merge-preview、mainline。普通候选/主线 checkout 必须匹配对应候选；merge-preview 还须 headCommit/baseCommit 与 task 候选及基线一致。未来报告必须分别说明候选、图/说明源码版本、实际 CI checkout 和报告所属提交，不能要求文件引用包含自身的 SHA。

manual PASS 须 machinePlatform 与原生目标相同。NOT_RUN/MANUAL_REQUIRED 风险不得消失，缺门、身份错误、假就绪、删除交接或修改任务绑定都失败。

## 受管分发与兼容

正式源码先实现、独立合同、提交；project-runtime preview/apply/verify 同步新 module/schema，manifest 固定 policy3/plan4/receipt3 和真实哈希。旧 policy3/plan3/receipt2 库存可校验后升级并回滚，不能伪认成新包。Harness 分发也须带齐新资源。运行副本不手改，不伪造 manifest；安装一致性不等于宿主已重新加载。

合同覆盖旧 receipt1/2、新 task 的 runner/checkout/machine、他平台交接、只读与绑定漂移、缺 supplemental gate、cross-platform 未覆盖、升级/回滚/漂移。真实平台/CI 证据由项目任务另行取得。
