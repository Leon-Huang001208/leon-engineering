# Skill 发现目录收敛

规范正文只维护在 core 与 workflows 两个活动插件的 `skills/` 目录。旧 commands 插件 ID 保留退休元数据，不提供规范 Skill 根，42 个旧名字也不参与本规划器的比较。全局同名目录可能让宿主重复发现或读到旧正文；本工具只按显式根目录产生可审查的候选清单，不自动改变插件启用、宿主配置或已安装目录。

## 只读规划

```bash
node scripts/skill-discovery-plan.mjs \
  --source-root /absolute/framework \
  --skills-root /absolute/user/.agents/skills \
  --skills-root /absolute/user/.codex/skills \
  --backup-root /absolute/private/skill-backup \
  --receipt /absolute/private/skill-receipt.json
```

标准输出是兼容现有 `skill-portfolio.mjs` 的 JSON 清单，附候选统计和跳过原因；规划器不写文件。只在调用者明确选择的输出路径重定向标准输出，保存候选清单。来源树、备份和回执均使用绝对路径；备份应在 Skill 发现根之外。

`--help` 与 `-h` 不读取项目或全局目录。若清单的 `actions` 为空，表示没有可迁移候选，不运行拒绝空批次的 portfolio 应用命令。

只有规范插件中存在的 Skill 名称参与比较。完全相同的整棵树可标记为 `exact-duplicate`；正文或参考文件有差异时默认跳过。显式加入 `--include-divergent` 才会生成保留原树哈希的 `quarantine` 候选，不把旧内容伪装为相同版本。Skill 符号链接视为所有权未知，不跟随或迁移；不在规范目录中的其他 Skill 不纳入清单。

## 预览、应用与回滚

```bash
node scripts/skill-portfolio.mjs --preview --manifest /absolute/private/skill-plan.json
node scripts/skill-portfolio.mjs --apply --manifest /absolute/private/skill-plan.json
node scripts/skill-portfolio.mjs --rollback --receipt /absolute/private/skill-receipt.json
```

应用是独立的全局目录迁移动作，需要任务已明确授权该范围。先审阅所有权、内容差异、显式调用兼容和备份位置。portfolio 会整批预检哈希与冲突，移动到私有备份后复核并记录回执；冲突不通过时不开始迁移。回滚继续核对源位置与备份内容，不能覆盖后来产生的文件。不能将“四个样本没有调用”解释为旧入口永久无人使用。

迁出默认目录不删除能力或历史数据；仍有效的方法保留在其权威资料中。旧命令源码退休与用户目录处理是分开的动作：本规划器不会因为某个 `source-command-*` 同名目录仍存在而自动迁移或删除它。用户明确要求删除指定旧副本时按该授权核对和执行，不强制生成备份。旧名字的显式调用者改用[退休映射](../plugins/leon-engineering-commands/command-map.json)中的现有入口或原生宿主行为。宿主是否重新扫描、过滤或缓存 Skill 目录必须单独实测；文件迁移回执不能代替真实宿主发现证据。
