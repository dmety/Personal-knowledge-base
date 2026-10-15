import { z } from "zod";
import { AppError, blankEntry, entrySchema, organizationItemSchema, topicSchema, type Entry, type OrganizationItem } from "./model";
import { topicPaths, topicIdsForPaths, orderedTopics, type Directory } from "./topics";
import type { Repository } from "./repository";

// The decision layer has no Sites, model-provider, or database imports at runtime.
export const organizationInputSchema=z.object({
  entry_id:z.string(), entry_version:z.number().int().positive(), directory_revision:z.number().int().nonnegative(),
  items:z.array(organizationItemSchema.omit({id:true,decision:true,feedback:true}).strict()).min(1).max(30),
});
export type OrganizationInput=z.infer<typeof organizationInputSchema>;
export const organizationLabels={classify:"归入已有主题",alias:"登记主题别名",new_topic:"建议新主题",topic_related:"主题横向关联",record_relation:"记录关联推荐"};
const normalize=(s:string)=>s.normalize("NFKC").trim().toLocaleLowerCase();
const topicContext=({name,parent_id,definition,scope}:Directory["topics"][number])=>({name,parent_id,definition,scope});
const sourceContent=(e:Entry)=>JSON.stringify([e.title,e.content,e.summary,e.evidence,e.notes,e.source_url,e.source_title,e.sources,e.attachments]);
function resolveItem(item:OrganizationItem,directory:Directory){
  if(item.action!=="new_topic")return item;
  const existing=directory.topics.find(t=>t.parent_id===(item.parent_id??null)&&[t.name,...t.aliases].some(n=>normalize(n)===normalize(item.name!)));
  if(!existing)return item;
  if(normalize(existing.definition)!==normalize(item.definition||"")||normalize(existing.scope)!==normalize(item.scope||""))throw new AppError("同名主题的定义或范围不同，请重新分析",409);
  return {...item,action:"classify" as const,topic_id:existing.id};
}
export function directoryContext(directory:Directory,entries:Entry[],query=""){
  const paths=topicPaths(directory.topics),q=normalize(query);
  return {revision:directory.revision,topics:orderedTopics(directory.topics).map(t=>({
    ...t,path:paths.get(t.id)!,match:!q?"all":normalize(t.name)===q||t.aliases.some(a=>normalize(a)===q)?"exact":normalize([paths.get(t.id),t.definition,t.scope,...t.aliases].join(" ")).includes(q)?"context":"none",
    representatives:[...new Set([...t.representative_ids,...entries.filter(e=>e.status==="reviewed"&&!e.organization_proposal&&e.topic_paths.includes(paths.get(t.id)!)).slice(0,3).map(e=>e.id)])].slice(0,5).flatMap(id=>{const e=entries.find(e=>e.id===id&&!e.organization_proposal);return e?[{id:e.id,short_id:e.short_id,title:e.title,summary:e.summary,version:e.version}]:[];}),
  })).filter(t=>t.match!=="none")};
}
export function organizationCandidates(directory:Directory,entries:Entry[],entry:Entry,queries:string[],limit=12){
  const tokens=[...new Set(queries.map(normalize).filter(Boolean))];
  const topics=directoryContext(directory,entries).topics.map(t=>({...t,score:tokens.reduce((n,q)=>n+(normalize(t.name)===q||t.aliases.some(a=>normalize(a)===q)?100:normalize([t.path,t.definition,t.scope,...t.aliases].join(" ")).includes(q)?10:0),0)})).filter(t=>t.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
  const candidates=entries.filter(e=>e.id!==entry.id&&!e.organization_proposal&&e.status!=="archived").map(e=>({...e,score:tokens.reduce((n,q)=>n+(normalize(e.title).includes(q)?10:0)+(normalize([...e.tags,...e.topic_paths].join(" ")).includes(q)?6:0)+(normalize(e.summary+" "+e.content).includes(q)?2:0),0)})).filter(e=>e.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(e=>({id:e.id,short_id:e.short_id,title:e.title,status:e.status,version:e.version,topic_paths:e.topic_paths,summary:e.summary,snippet:e.content.slice(0,300),score:e.score}));
  const candidateTopicIds=new Set(topics.map(t=>t.id));
  const feedback=entries.filter(e=>e.organization_proposal).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).flatMap(e=>e.organization_proposal!.items.filter(i=>i.decision!=="pending"&&(e.revision_of===entry.id||candidateTopicIds.has(i.topic_id||"")||i.name&&tokens.some(q=>normalize(i.name!).includes(q)))).map(i=>({action:i.action,topic_id:i.topic_id,target_id:i.target_id,name:i.name,decision:i.decision,reason:i.reason,feedback:i.feedback}))).slice(0,20);
  return {directory_revision:directory.revision,entry_version:entry.version,topics,entries:candidates,feedback,retrieval:"keyword_and_alias",instructions:"候选分数只用于检索，不证明关系。必须读取原文；无法归类可保持未分类。新词先作标签，优先复用目录；同义才能建议别名，强相关不等于同义。"};
}
function validateItem(item:OrganizationItem,base:Entry,directory:Directory,entries:Entry[]){
  const byId=new Map(directory.topics.map(t=>[t.id,t]));
  if(["classify","alias","topic_related"].includes(item.action)&&!byId.has(item.topic_id||""))throw new AppError("请选择已有主题 ID；新主题必须单独建议");
  if(["alias","new_topic"].includes(item.action)&&(!item.name||item.name.includes("/")))throw new AppError("请填写有效名称或别名");
  if(item.action==="new_topic"){
    if(!item.definition?.trim())throw new AppError("新主题必须解释独立含义与已有主题的区别");
    if(item.parent_id&&!byId.has(item.parent_id))throw new AppError("父主题不存在");
    if(directory.topics.some(t=>t.parent_id===(item.parent_id??null)&&[t.name,...t.aliases].some(n=>normalize(n)===normalize(item.name!))))throw new AppError("同层已有相同名称或别名，请复用已有主题");
    topicPaths([...directory.topics,topicSchema.parse({id:"candidate-"+item.id,name:item.name,parent_id:item.parent_id??null,position:0,version:1})]);
  }
  if(item.action==="alias"){
    const topic=byId.get(item.topic_id!)!;
    if([topic.name,...topic.aliases].some(n=>normalize(n)===normalize(item.name!)))throw new AppError("该名称或别名已经存在");
    if(directory.topics.some(t=>t.id!==topic.id&&t.parent_id===topic.parent_id&&[t.name,...t.aliases].some(n=>normalize(n)===normalize(item.name!))))throw new AppError("同层已有该名称或别名，不能自动视为同义");
  }
  if(item.action==="topic_related"){
    if(!byId.has(item.target_id||"")||item.target_id===item.topic_id)throw new AppError("主题关联目标不存在或指向自身");
    const paths=topicPaths(directory.topics),a=paths.get(item.topic_id!)!,b=paths.get(item.target_id!)!;
    if(a.startsWith(b+" / ")||b.startsWith(a+" / "))throw new AppError("上下位主题已有层级联系，不重复建立横向关联");
    if(byId.get(item.topic_id!)!.links.some(l=>l.target_id===item.target_id))throw new AppError("主题关联已存在");
  }
  if(item.action==="record_relation"){
    const target=entries.find(e=>e.id===item.target_id&&!e.organization_proposal&&e.status!=="archived");
    if(!target||target.id===base.id)throw new AppError("记录关联目标不存在、已归档或指向自身");
    if(item.strength==="strong"&&!item.kind)throw new AppError("强关联必须指定具体关系类型");
    if(item.strength==="strong"&&base.relations.some(r=>r.target_id===item.target_id&&r.kind===item.kind))throw new AppError("正式关系已经存在");
    if(!item.evidence.some(e=>e.entry_id===target.id))throw new AppError("记录关联需要目标记录的原文依据");
  }
  if(!item.evidence.some(e=>e.entry_id===base.id))throw new AppError("建议必须包含当前资料中的原文依据");
  for(const quote of item.evidence){const e=entries.find(e=>e.id===quote.entry_id&&!e.organization_proposal);if(!e||!e[quote.field].includes(quote.quote))throw new AppError("引用摘录与原记录不一致，请读取原文后重新建议");}
}
export class OrganizationService {
  constructor(private repo:Repository){}
  private async validateAcceptance(draft:Entry,item:OrganizationItem,directory:Directory,entries:Entry[]){
    const proposal=draft.organization_proposal!,base=entries.find(e=>e.id===draft.revision_of);
    if(!base||base.status==="archived"||base.organization_proposal)throw new AppError("原记录不存在或已归档，请重新分析",409);
    if(proposal.directory_revision===0)throw new AppError("恢复合并后的建议需要重新分析",409);
    const versions={...proposal.evidence_versions,[base.id]:draft.base_version};
    for(const id of new Set([base.id,...item.evidence.map(q=>q.entry_id)])){
      const current=entries.find(e=>e.id===id&&!e.organization_proposal&&e.status!=="archived");
      if(!current)throw new AppError("依据记录不存在或已归档，请重新分析",409);
      if(current.version!==versions[id]){
        const history=await this.repo.histories(id);
        const previous=history.flatMap(h=>[h.before,h.after]).find(e=>e?.id===id&&e.version===versions[id]);
        if(!previous||sourceContent(previous)!==sourceContent(current))throw new AppError("依据记录已更新，请重新分析",409);
      }
    }
    const resolved=resolveItem(item,directory);
    const relevant=new Set([resolved.topic_id,item.parent_id,...(item.action==="topic_related"?[item.target_id]:[])].filter((id):id is string=>!!id));
    for(const id of relevant){
      const current=directory.topics.find(t=>t.id===id),previous=proposal.topic_context?.[id];
      if(previous&&(!current||JSON.stringify(previous)!==JSON.stringify(topicContext(current))))throw new AppError("目标主题的名称、层级或含义已变化，请重新分析",409);
    }
    validateItem(resolved,base,directory,entries);
    return resolved;
  }
  async assess(draft:Entry){
    if(!draft.organization_proposal)return {};
    const directory=await this.repo.topics(),entries=await this.repo.list(),errors:Record<string,string>={};
    for(const item of draft.organization_proposal.items.filter(i=>i.decision==="pending")){
      try{await this.validateAcceptance(draft,item,directory,entries);}catch(e){errors[item.id]=e instanceof Error?e.message:"无法验证建议";}
    }
    return errors;
  }
  async propose(raw:unknown){
    const input=organizationInputSchema.parse(raw),directory=await this.repo.topics(),base=await this.repo.get(input.entry_id),entries=await this.repo.list();
    if(base.organization_proposal||base.status==="archived")throw new AppError("请选择未归档的原始记录");
    if(base.version!==input.entry_version||directory.revision!==input.directory_revision)throw new AppError("记录或主题目录已变化，请重新读取后建议",409);
    const items=input.items.map(i=>organizationItemSchema.parse({...i,id:crypto.randomUUID()}));
    const keys=items.map(i=>[i.action,i.topic_id,i.target_id,i.name,i.parent_id,i.kind].join("|"));if(new Set(keys).size!==keys.length)throw new AppError("建议包含重复项目");
    for(const item of items)validateItem(item,base,directory,entries);
    const signature=(list:OrganizationItem[])=>JSON.stringify(list.map(({id,decision,feedback,...rest})=>rest));
    const duplicate=entries.find(e=>e.status==="draft"&&e.revision_of===base.id&&e.base_version===base.version&&e.organization_proposal?.directory_revision===directory.revision&&signature(e.organization_proposal.items)===signature(items));
    if(duplicate)return duplicate;
    const evidence_versions=Object.fromEntries([...new Set(items.flatMap(i=>i.evidence.map(q=>q.entry_id)))].map(id=>[id,entries.find(e=>e.id===id)!.version]));
    const topic_context=Object.fromEntries(directory.topics.map(t=>[t.id,topicContext(t)]));
    const draft=blankEntry({title:`整理建议 · ${base.title||base.id}`,content:"",status:"draft",created_by:"ai",revision_of:base.id,base_version:base.version,reason:"仅调整分类和关系；逐项确认，不修改原文或内容审核状态。",organization_proposal:{directory_revision:directory.revision||1,items,evidence_versions,topic_context}},"ai");
    await this.repo.commit([{before:null,after:draft,action:"AI 提交组织建议"}],"ai",[],directory);return draft;
  }
  async review(id:string,itemId:string,accept:boolean,version:number,feedback=""){
    const draft=await this.repo.get(id),proposal=draft.organization_proposal;
    if(!proposal||draft.status!=="draft")throw new AppError("这不是待审核的组织建议");
    if(version!==draft.version)throw new AppError("建议已变化，请刷新",409);
    const selected=proposal.items.find(i=>i.id===itemId);if(!selected||selected.decision!=="pending")throw new AppError("建议项目不存在或已处理");
    let item:OrganizationItem=selected;
    const directory=await this.repo.topics(),base=await this.repo.get(draft.revision_of!),now=new Date().toISOString();
    let after=structuredClone(base),topics=structuredClone(directory.topics);
    if(accept){
      const entries=await this.repo.list();
      item=await this.validateAcceptance(draft,item,directory,entries);
      const topic=topics.find(t=>t.id===item.topic_id);
      if(item.action==="classify"){after.topic_paths=[...new Set([...after.topic_paths,topicPaths(topics).get(item.topic_id!)!])];}
      if(item.action==="alias"){topic!.aliases=[...topic!.aliases,item.name!];topic!.version++;}
      if(item.action==="new_topic"){
        const created=topicSchema.parse({id:crypto.randomUUID(),name:item.name,parent_id:item.parent_id??null,definition:item.definition,scope:item.scope??"",representative_ids:[base.id],position:Math.max(-1,...topics.filter(t=>t.parent_id===(item.parent_id??null)).map(t=>t.position))+1,version:1});topics.push(created);after.topic_paths=[...new Set([...after.topic_paths,topicPaths(topics).get(created.id)!])];
      }
      if(item.action==="topic_related"){topic!.links.push({target_id:item.target_id!,note:item.reason,strength:item.strength,basis:item.basis,evidence:item.evidence});topic!.version++;}
      if(item.action==="record_relation"&&item.strength==="strong"){after.relations.push({target_id:item.target_id!,kind:item.kind!,note:`${item.basis==="inference"?"AI 推断：":"原文依据："}${item.reason}\n${item.evidence.map(q=>`${q.entry_id}：${q.quote}`).join("\n")}`.slice(0,2000)});}
      if(item.action==="record_relation")after.related_recommendations=[...after.related_recommendations.filter(r=>!(r.target_id===item.target_id&&r.kind===item.kind)),{...item,decision:"accepted",feedback}];
      after=entrySchema.parse({...after,topic_ids:topicIdsForPaths(after.topic_paths,topics),version:base.version+1,updated_at:now});
    }
    const updatedProposal={...proposal,items:proposal.items.map(i=>i.id===itemId?{...item!,decision:accept?"accepted" as const:"rejected" as const,feedback}:i),evidence_versions:{...proposal.evidence_versions,...(accept?{[base.id]:after.version}:{})}};
    // Rebase remaining items from this same proposal after each atomic acceptance.
    // Rejecting an item must not make an otherwise stale proposal current again.
    if(accept)updatedProposal.directory_revision=directory.revision+(JSON.stringify(topics)!==JSON.stringify(directory.topics)?1:0);
    const next=entrySchema.parse({...draft,organization_proposal:updatedProposal,base_version:accept?after.version:draft.base_version,version:draft.version+1,updated_at:now,status:updatedProposal.items.some(i=>i.decision==="pending")?"draft":"archived"});
    await this.repo.commit([...(accept?[{before:base,after,action:`接受组织建议：${organizationLabels[item.action]}`}]:[]),{before:draft,after:next,action:accept?"确认组织建议项目":"拒绝组织建议项目"}],"human",[],{revision:directory.revision,topics});
    return {entry:next,base:accept?after:base};
  }
}
