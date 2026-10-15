---
name: zhixu-setup
description: 指导使用者在自己的 Sites 账号中部署知序并连接个人知识插件；用于知序安装、资源配置或连接排查。
---

先区分用户需要部署新实例还是连接已有实例。知序开源仓库是 https://github.com/dmety/zhixu 。本技能包只有指导和工作流，不含可调用的共享 MCP，不提供作者的站点资源。

部署时阅读 [Sites 部署步骤](references/sites-deployment.md)。有可用 Sites 插件时使用其技能与原生工作流；没有时提供安装 Sites 插件和打开仓库的步骤，不能声称创建了资源。只在用户自己的克隆目录和账号操作。保留已有实例的 ID，创建超时先查询确认，不重复创建；不能复制他人的项目 ID、连接地址、身份头或凭据。

连接时让 Sites 查询目标实例的 `get_site(include_mcp_connection=true)`，使用返回的个人插件安装入口；也可提示用户打开 Plugins > Personal > Created by you，选择自己的实例并 Install / Connect。平台托管连接不改为手写本地 MCP 或硬编码远程地址。

确认数据工具来自目标实例后，用只读 `search_knowledge` 验证。空结果也是有效响应；没有实际成功调用时明确连接仍待验证。多个连接可用时先确认本次目标。不通过创建草稿来试连接，不读取不相关的个人资料。

完成后使用 `$knowledge-workflow` 进行收集和整理。AI 只提出待审核内容与组织建议，最终审核在用户站点完成。
