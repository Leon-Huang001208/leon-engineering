# leon-engineering Agent Rules

## 开始工作

- 默认使用中文沟通。
- 修改文件前先读该文件、`README.md`、`docs/ARCHITECTURE.md` 和 `docs/DEVELOPMENT_MAP.md` 中相关条目。
- 先核对分支、HEAD、工作区和现有 worktree；保留用户与其他任务的改动。
- 共享内核、协议、安装、Hook、CI 或跨项目接入使用隔离 worktree；窄小且无冲突的文档修复可本地完成。

## 代码与接口

- 所有 CLI 必须有明确错误处理，并以结构化、脱敏、有限输出记录失败；库函数使用稳定错误码，不吞错。
- 保留公开脚本路径、导出函数、CLI 参数、退出码、插件 ID、Hook 配置和已发布 manifest 的兼容读取。
- `lib/` 不依赖业务项目或宿主 adapter；项目特定路径只进入项目配置；宿主差异只进入 `adapters/`。
- 不执行策略中的任意命令字符串。执行器只接受稳定、已登记、非交互 verifier ID 和 argv。
- 修改 Skill 时同步其正文、引用文档和合同测试；不要新增同名平行 Skill 真源。

## 测试与证据

- 新行为和缺陷修复先写失败合同，再做最小实现和回归。
- 验收引擎、策略、回执、schema、安装、Hook、CI 与发布路径修改必须运行独立固定合同，不能只靠被修改的规划器宣称通过。
- 不把未运行、skip、pending、manual required 或外部门写成 pass。
- 新依赖、全局安装、宿主重启、push、PR、tag、release、workflow dispatch、秘密、费用和破坏性操作需要单独明确授权。

## 文档治理

- `docs/architecture-map.json` 是模块职责、源码归属、权威文档和测试资产的机器清单。
- 项目验收策略是变更到验证的唯一机器路由；不要在开发地图、Skill 和多个脚本中复制路由表。
- 源码职责、公共接口、分发清单或验证契约改变时，同步 `README.md`、架构/开发地图和相关模块文档。
- 历史设计与证据保留日期和状态，不能冒充现行操作指南。

## 最小本地门

```bash
node scripts/check-architecture-map.mjs --project .
node scripts/verification-plan.mjs --project . --base <基线提交>
node scripts/project-constraints.mjs --project . --changed-file <完整变更路径>
node --test tests/*.test.mjs
git diff --check
```

远端 CI、原生平台、真实宿主和发布状态必须单独报告。
