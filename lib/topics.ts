import { z } from "zod";
import { AppError, topicPathSchema, topicSchema, type Entry } from "./model";

export { topicSchema };
export type Topic = z.infer<typeof topicSchema>;
export type Directory = {revision:number;topics:Topic[]};
export type TopicFile = {id:string;title:string;kind:Entry["kind"];version:number};
export type TopicItem = Topic & {path:string;count:number;files:TopicFile[]};
export function topicPaths(topics:Topic[]) {
  if(topics.length>10000)throw new AppError("主题目录最多 10000 个节点");
  const byId=new Map(topics.map(t=>[t.id,t]));
  if(byId.size!==topics.length)throw new AppError("主题 ID 重复");
  const paths=new Map<string,string>();
  function path(id:string,seen=new Set<string>()):string {
    if(paths.has(id))return paths.get(id)!;
    const t=byId.get(id);if(!t)throw new AppError("主题缺少父节点");
    if(seen.has(id))throw new AppError("主题不能移入自身或后代");
    seen.add(id);const p=t.parent_id?path(t.parent_id,seen)+" / "+t.name:t.name;
    const result=topicPathSchema.safeParse(p);if(!result.success)throw new AppError("主题最多五层，每层最多 80 字");
    paths.set(id,result.data);return result.data;
  }
  const names=new Set<string>();for(const raw of topics){const t=topicSchema.parse(raw);const key=JSON.stringify([t.parent_id,t.name]);if(names.has(key))throw new AppError("同一父主题下名称不能重复");names.add(key);path(t.id);}
  for(const t of topics)for(const link of t.links||[]){if(!byId.has(link.target_id))throw new AppError("主题关联目标不存在");if(link.target_id===t.id)throw new AppError("主题不能关联自身");}
  return paths;
}
export function orderedTopics(topics:Topic[]):Topic[] {
  topicPaths(topics);const result:Topic[]=[];
  function walk(parent:string|null){for(const t of topics.filter(t=>t.parent_id===parent).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name,"zh-CN")||a.id.localeCompare(b.id))){result.push(t);walk(t.id);}}
  walk(null);return result;
}
export function mergeTopicPaths(topics:Topic[],paths:string[]):Topic[] {
  const result=topics.map(t=>topicSchema.parse(t)),existing=topicPaths(result),byPath=new Map([...existing].map(([id,p])=>[p,id]));
  for(const raw of paths){const parts=topicPathSchema.parse(raw).split(" / ");let parent:string|null=null;for(let i=0;i<parts.length;i++){const p=parts.slice(0,i+1).join(" / ");let id=byPath.get(p);if(!id){id=crypto.randomUUID();result.push(topicSchema.parse({id,parent_id:parent,name:parts[i],position:Math.max(-1,...result.filter(t=>t.parent_id===parent).map(t=>t.position))+1,version:1}));byPath.set(p,id);}parent=id;}}
  return result;
}
export function directoryItems(topics:Topic[],entries:Entry[]):TopicItem[] {
  const paths=topicPaths(topics),records=knowledgeRecords(entries);return orderedTopics(topics).map(t=>{const path=paths.get(t.id)!;return {...t,path,count:records.filter(e=>e.topic_paths.some(p=>p===path||p.startsWith(path+" / "))).length,files:records.filter(e=>e.topic_paths.includes(path)).map(e=>({id:e.id,title:e.title||"未命名知识",kind:e.kind,version:e.version}))};});
}
export function knowledgeRecords(entries:Entry[]){return entries.filter(e=>e.status!=="archived"&&!e.organization_proposal&&!e.revision_of);}
export function unclassifiedCount(entries:Entry[]){return knowledgeRecords(entries).filter(e=>!e.topic_paths.length).length;}
export function topicIdsForPaths(paths:string[],topics:Topic[]){const byPath=new Map([...topicPaths(topics)].map(([id,p])=>[p,id]));return paths.flatMap(p=>byPath.has(p)?[byPath.get(p)!]:[]);}
export const topicMutationSchema=z.object({action:z.enum(["create","rename","move","delete","describe"]),revision:z.number().int().nonnegative(),id:topicSchema.shape.id.optional(),name:topicSchema.shape.name.optional(),parent_id:topicSchema.shape.parent_id.optional(),anchor_id:topicSchema.shape.id.optional(),placement:z.enum(["before","after"]).optional(),definition:topicSchema.shape.definition.optional(),scope:topicSchema.shape.scope.optional(),aliases:topicSchema.shape.aliases.optional(),representative_ids:topicSchema.shape.representative_ids.optional()});
export function changeDirectory(directory:Directory,entries:Entry[],input:z.infer<typeof topicMutationSchema>) {
  if(input.revision!==directory.revision)throw new AppError("主题目录已变化，请刷新后重试",409);
  const oldPaths=topicPaths(directory.topics);let topics=directory.topics.map(t=>({...t}));let deletedPath:string|undefined;
  let node=topics.find(t=>t.id===input.id);
  if(input.action!=="create"&&!node)throw new AppError("主题不存在",404);
  if(input.action==="create"){
    if(!input.name)throw new AppError("请填写主题名称");node=topicSchema.parse({id:crypto.randomUUID(),name:input.name,parent_id:input.parent_id??null,position:Math.max(-1,...topics.filter(t=>t.parent_id===(input.parent_id??null)).map(t=>t.position))+1,version:1});topics.push(node);
  }else if(input.action==="describe"){
    for(const rid of input.representative_ids||[])if(!entries.some(e=>e.id===rid&&!e.organization_proposal))throw new AppError("代表记录不存在");
    Object.assign(node!,{definition:input.definition??node!.definition,scope:input.scope??node!.scope,aliases:[...new Set(input.aliases??node!.aliases)],representative_ids:input.representative_ids??node!.representative_ids});
  }else if(input.action==="rename"){
    if(!input.name)throw new AppError("请填写主题名称");node!.name=input.name;
  }else if(input.action==="delete"){
    const path=oldPaths.get(node!.id)!;
    if(topics.some(t=>t.parent_id===node!.id))throw new AppError("请先移动或删除子主题，再删除此主题");
    if(topics.some(t=>t.links.some(l=>l.target_id===node!.id))||node!.links.length||entries.some(e=>(e.organization_proposal?.items||[]).some(i=>i.topic_id===node!.id||i.parent_id===node!.id||i.action==="topic_related"&&i.target_id===node!.id)))throw new AppError("该主题仍被主题关联或组织建议引用，请先解除引用");
    deletedPath=path;
    topics=topics.filter(t=>t.id!==node!.id);
  }else {
    node!.parent_id=input.parent_id??null;
    const siblings=topics.filter(t=>t.parent_id===node!.parent_id&&t.id!==node!.id).sort((a,b)=>a.position-b.position);
    let index=siblings.length;if(input.anchor_id){index=siblings.findIndex(t=>t.id===input.anchor_id);if(index<0)throw new AppError("排序目标不存在");if(input.placement==="after")index++;}
    siblings.splice(index,0,node!);siblings.forEach((t,i)=>{t.position=i;});
  }
  const newPaths=topicPaths(topics);
  topics=topics.map(t=>{const old=directory.topics.find(n=>n.id===t.id);return {...t,version:old&&(JSON.stringify(old)!==JSON.stringify(t)||oldPaths.get(t.id)!==newPaths.get(t.id))?old.version+1:t.version};});
  const replacements=new Map([...oldPaths].filter(([id,p])=>newPaths.has(id)&&newPaths.get(id)!==p).map(([id,p])=>[p,newPaths.get(id)!]));
  const changes=entries.flatMap(before=>{const paths=before.topic_paths.map(p=>p===deletedPath?undefined:replacements.get(p)??p).filter((p):p is string=>p!==undefined);if(paths.length===before.topic_paths.length&&paths.every((p,i)=>p===before.topic_paths[i]))return [];return [{before,after:{...before,topic_paths:[...new Set(paths)],version:before.version+1,updated_at:new Date().toISOString()},action:input.action==="rename"?"主题重命名":input.action==="delete"?"删除主题归属":"主题目录移动"}];});
  return {topics,changes,node_id:node?.id};
}
