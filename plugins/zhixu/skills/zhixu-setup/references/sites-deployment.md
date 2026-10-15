# 自己的 Sites 实例

完整站点源码和中文说明：https://github.com/dmety/Personal-knowledge-base 。需要 Node.js 24 LTS、Git、支持 Sites 的账号及已连接的 Sites 插件。

1. 克隆仓库到用户自己的目录；运行 `npm run install:ci`、`npm run build`、`npm run db:migrate:local`、`npm run dev` 验证本地空库。示例仅主动导入。
2. 线上发布先读 Sites 技能和 `.openai/hosting.json`。模板只有 `d1: DB`、`r2: BUCKET`、`capabilities: [mcp]`。没有项目 ID 才用用户自己的账号创建新站点并持久化返回 ID；有 ID 时先确认归属并复用。
3. 设为仅本人访问，使用自己账号的 D1/R2。原生 Sites 工作流完成源码同步、构建、迁移和发布；凭据只通过隐藏 stdin 传递，不进入源码或对话输出。不能把开发模拟登录部署成公共认证。
4. 确认真实部署终态和 URL；通过 `get_site(include_mcp_connection=true)` 获取该实例个人插件安装入口，再完成用户认证与只读测试。

如果当前工具缺失，给出以上可操作步骤并说明未执行的部分。移到 Sites 之外需要额外认证与 OAuth 实现，不属于第一版即用部署。

备份和附件只能进入用户自己的实例或私有备份位置；不能上传到公开仓库。完整指南：https://github.com/dmety/Personal-knowledge-base/blob/main/docs/部署与迁移.md 。
