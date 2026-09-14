{{LEON_ENGINEERING_SHARED_POLICY_IMPORT}}

## Claude 平台差异

Claude 插件的写入型工具 Hook 建立或恢复宿主隔离的 Harness 上下文。初始化失败时仅放行明确的只读恢复诊断；项目写入、其他 shell 和未知工具 fail closed，并输出不含项目输入的脱敏诊断。

Claude 可使用插件中的持久、工具受限命名代理；只能路由 `docs/shared-capability-catalog.md` 登记的规范角色，代理不得递归委派。
