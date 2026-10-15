# AI 分类与关系判断

第一版在已连接插件的对话中触发，站内“待审核”逐项接受或拒绝。上传保存不会自动调用模型，PDF/OCR 和语义向量检索尚未接入。

可以对 AI 说：“先读我的完整主题目录，按已有主题整理这条笔记；新词先作标签，说明与历史资料的关系并引用双方原文。需要新主题时单独提出建议，不修改正文。”

## 使用与判断

- 在主题菜单“含义与别名”填写定义、适用范围、别名及代表记录；空主题也能被 AI 读取。可在这里查看主题横向关联。
- AI 先读完整目录，再匹配名称、别名、目录说明和相关记录；多个短概念分别查找，检索分数不表示关系可靠程度。
- 同义才建议别名。上下位关系体现在目录，跨分支相关可以保留双方主题。没有合适分类时保留未分类，不硬塞入目录。
- 新主题先作为建议存在，审核通过才创建并归类；不会因为 AI 草稿出现新路径而创建目录。
- 记录关系中，强关联候选必须有具体类型和双方摘录，接受后建立正式关系；弱关联接受后只保留在记录详情“相关内容推荐”。AI 自报的 explicit 并不是机器证明，界面要求用户核对。
- 每项接受只修改组织信息；原文、来源、附件、记录创建者和内容审核状态保留。拒绝反馈进入后续相关候选上下文，没有训练模型或创建永久禁止规则。
- 记录、主题目录或依据记录变化会阻止过期建议被接受。相同版本重复提交相同项目返回原建议。

## 可复用接口

`lib/organization.ts` 的运行时不依赖 Sites、Cloudflare 或模型厂商。OrganizationService 接收 Repository；directoryContext 和 organizationCandidates 是纯数据函数。网站 HTTP 与 MCP 复用同一服务，迁出平台时替换认证、Repository 和 AI 调用方。

新增 MCP：

| 工具 | 输入/输出 |
| --- | --- |
| get_topic_directory | 可选 query；不传返回完整目录、revision、稳定 ID、含义、别名、空主题、代表记录和关联 |
| find_organization_candidates | entry_id、queries、可选 limit；返回主题/记录候选、版本、相关审核反馈。当前检索为名称/别名与关键词，不是向量搜索 |
| propose_knowledge_organization | entry_id、entry_version、directory_revision、items；返回独立的待审核组织建议 |

items 使用 classify、alias、new_topic、topic_related、record_relation；均需 reason 和引用当前记录的 evidence。记录关联还需引用目标记录。evidence 指明 entry_id、field（content/summary/evidence/notes）、quote；系统检查 quote 原样存在并保存依据记录版本。

模型可更换，采用同一结构化结果与校验接口。用户只需要维护自己的目录和粒度，不需要采用固定领域词表；第一版没有后台模型服务或独立模型适配器。仅凭相似度不能证明同义、依赖或因果。实际模型分类效果仍需用用户真实资料评测，当前测试验证规则与流程。

## 兼容与备份

主题增加 definition、scope、aliases、representative_ids、links；旧主题读取补空值。记录增加 topic_ids、organization_proposal、related_recommendations；旧记录继续接受 topic_paths，写入时按精确路径同步稳定 ID，绝不自动做语义合并。

建议保存在现有 entries/history，复用用户隔离及原子事务，不新增数据库表。目录 revision 仅在目录变化时递增，记录变化使用自身 version；空目录第一次持久化初始化为 revision 1。

完整备份升级 v3；v1/v2 仍可导入。空库恢复 v3 保留主题 ID 和含义、别名、关联、建议及审核反馈；向已有库导入按精确路径映射 ID，同路径保留当前主题的描述、别名和关联。合并导入的组织建议保留历史但不能接受，需重新分析；空库恢复的待审核建议可继续审核。历史快照保持导出时的表示。

## 验证

运行 `node scripts/test-core.mjs`、`node scripts/test-organization.mjs`、`node scripts/test-storage.mjs`、TypeScript 检查。启动本地预览后运行 HTTP 与组织建议浏览器验收。浏览器脚本使用本机已有 Edge，只创建本地虚构资料；当前脚本的浏览器路径需按复用者系统调整。

覆盖学习、技术、历史目录，别名匹配、空主题、重复提交、新主题拒绝、逐项审核、弱关联与正式关系分离、伪造摘录、版本冲突、D1 并发、用户隔离和 v3 恢复。后续升级语义检索，应补同义表达召回与不同概念错误合并的模型评测，避免只用主题数量下降衡量效果。
