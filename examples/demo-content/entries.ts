import { blankEntry } from "../../lib/model";
const at="2026-10-09T00:00:00.000Z";
export function makeDemoEntries(){return [
  blankEntry({id:"demo-learning",topic_paths:["个人成长 / 学习方法"],title:"把阅读变成自己的知识",summary:"记录来源、写下理解，再通过主动回忆检验掌握。",content:"## 阅读之后，留下什么？\n\n这是一条虚构的学习方法示例。收集只是起点，把内容用自己的话重新表达，才能发现理解中的空白。\n\n### 我的整理步骤\n\n1. 保存有价值的原文摘录\n2. 写下它解决的具体问题\n3. 用一个自己的例子解释\n4. 一周后尝试不看笔记复述\n\n> 示例内容不代表研究结论，请为真实观点补充来源。",kind:"idea",status:"reviewed",tags:["学习方法","知识管理"],notes:"虚构示例，可归档。",created_at:at,updated_at:at}),
  blankEntry({id:"demo-project",topic_paths:["个人成长 / 知识管理"],relations:[{target_id:"demo-learning",kind:"example",note:"虚构示例：知识库是学习方法的应用场景"}],title:"个人知识库：先让信息流动起来",summary:"收集 → 整理 → 审核 → 使用，是知识库的最小循环。",content:"## 一个可持续的小系统\n\n每条记录有稳定 ID，保留来源和历史。AI 帮助整理，最终由本人确认。\n\n- 收集箱保存尚未处理的资料\n- 草稿接收 AI 整理建议\n- 已整理记录作为稳定知识\n- 归档保留历史，默认不参与检索",kind:"project",status:"reviewed",tags:["知识管理","产品设计"],related_ids:["demo-learning"],created_at:at,updated_at:at}),
  blankEntry({id:"demo-inbox",title:"灵感：给每条笔记写一个问题",summary:"以后检索时，从问题进入，而不只是从标签进入。",content:"整理资料时，增加一句：这条记录回答什么问题？\n\n这是虚构的收集箱示例，等待本人整理。",kind:"idea",status:"inbox",tags:["写作","知识管理"],created_at:at,updated_at:at}),
  blankEntry({id:"demo-draft",title:"AI 草稿：每周复核收集箱",summary:"一个等待确认的整理建议。",content:"## 每周十分钟\n\n检查新资料，补充来源，合并相似想法，并归档暂时用不到的内容。\n\n这条内容由虚构 AI 示例生成，尚未审核，不能作为已确认事实。",kind:"reference",status:"draft",created_by:"ai",tags:["知识管理"],created_at:at,updated_at:at},"ai")
];}

