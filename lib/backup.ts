import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { AppError, backupSchema, entrySchema, topicSchema, magicMime, type Backup, type Entry, type History, type OrganizationItem } from "./model";
import type { Repository } from "./repository";
import { mergeTopicPaths, orderedTopics, topicPaths } from "./topics";

export async function makeBackup(repo:Repository){
  const versions=(entries:Entry[])=>JSON.stringify(entries.map(e=>[e.id,e.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  for(let attempt=0;attempt<3;attempt++){
    const directory=await repo.topics(),entries=await repo.list(),history=await repo.histories(),personal_profile=await repo.readProfile?.()||null;
    if((await repo.readTopics()).revision===directory.revision&&versions(entries)===versions(await repo.list())&&personal_profile?.version===(await repo.readProfile?.())?.version)return {format:"zhixu-backup" as const,schema_version:personal_profile?4 as const:3 as const,exported_at:new Date().toISOString(),entries,history,topics:directory.topics,personal_profile};
  }
  throw new AppError("知识库正在更新，请稍后重新导出",409);
}
export function markdown(e:Entry){
  const yaml=Object.entries(e).filter(([k])=>k!=="content").map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n");
  return `---\n${yaml}\n---\n\n# ${e.title||"未命名记录"}\n\n${e.content}\n\n${e.attachments.map(a=>`[${a.name.replace(/[\[\]]/g,"")}](../${a.path})`).join("\n")}\n`;
}
export async function zipBackup(repo:Repository,backup:Backup){
  const files:Record<string,Uint8Array>={"backup.json":strToU8(JSON.stringify(backup,null,2))};
  let total=0;
  for(const e of backup.entries){files[`entries/${e.id}.md`]=strToU8(markdown(e));for(const a of e.attachments){if(files[a.path])continue;const asset=await repo.readAsset(a.id);if(!asset)throw new AppError(`附件缺失：${a.name}，请修复后导出`);total+=asset.size;if(total>60*1024*1024)throw new AppError("完整备份附件超过 60 MB，请分批迁移或使用 R2 迁移说明");files[a.path]=new Uint8Array(await asset.arrayBuffer());}}
  return zipSync(files,{level:0});
}
export function parseBackup(bytes:Uint8Array,isZip:boolean){
  let files:Record<string,Uint8Array>={};let backup:Backup;
  if(isZip){let total=0;files=unzipSync(bytes,{filter:f=>{if(!/^(backup\.json|assets\/[a-zA-Z0-9_-]+|entries\/[a-zA-Z0-9_-]+\.md)$/.test(f.name))throw new AppError("备份包含不安全路径");total+=f.originalSize;if(total>80*1024*1024)throw new AppError("解压后超过 80 MB 限制");return !f.name.startsWith("entries/");}});if(!files["backup.json"])throw new AppError("ZIP 缺少 backup.json");backup=backupSchema.parse(JSON.parse(strFromU8(files["backup.json"])));}
  else backup=backupSchema.parse(JSON.parse(strFromU8(bytes)));
  if(new Set(backup.entries.map(e=>e.id)).size!==backup.entries.length)throw new AppError("备份内部存在重复记录 ID");
  topicPaths(backup.topics);
  if(backup.schema_version===1)backup.topics=mergeTopicPaths(backup.topics,backup.entries.flatMap(e=>e.topic_paths));
  else {const paths=new Set(topicPaths(backup.topics).values());if(backup.entries.some(e=>e.topic_paths.some(p=>!paths.has(p))))throw new AppError("备份中的记录缺少主题目录节点");}
  const topicIds=new Set(backup.topics.map(t=>t.id));
  for(const e of backup.entries){
    if(e.topic_ids.some(id=>!topicIds.has(id)))throw new AppError("记录引用了不存在的主题 ID");
    for(const i of e.organization_proposal?.items||[]){if(i.topic_id&&!topicIds.has(i.topic_id)||i.parent_id&&!topicIds.has(i.parent_id)||i.action==="topic_related"&&i.target_id&&!topicIds.has(i.target_id))throw new AppError("组织建议引用了不存在的主题");}
  }
  const attachmentIds=new Map<string,string>();
  for(const e of backup.entries)for(const a of e.attachments){if(a.path!==`assets/${a.id}`)throw new AppError("附件路径与 ID 不一致");const signature=JSON.stringify(a);if(attachmentIds.has(a.id)&&attachmentIds.get(a.id)!==signature)throw new AppError("附件 ID 元数据冲突");attachmentIds.set(a.id,signature);const b=files[a.path];if(b&&(b.length!==a.size||magicMime(b)!==a.mime))throw new AppError(`附件格式或大小不一致：${a.name}`);}
  return {backup,files};
}
export async function previewImport(repo:Repository,backup:Backup,files:Record<string,Uint8Array>){
  const existing=await repo.list(),ids=new Set(existing.map(e=>e.id)),allIds=new Set([...ids,...backup.entries.map(e=>e.id)]);
  const duplicates=backup.entries.filter(e=>ids.has(e.id)).map(e=>({id:e.id,title:e.title}));const missingAssets:{entry_id:string;name:string}[]=[];
  for(const e of backup.entries)for(const a of e.attachments)if(!files[a.path]&&!await repo.readAsset(a.id))missingAssets.push({entry_id:e.id,name:a.name});
  const missingRelations=backup.entries.flatMap(e=>[...e.related_ids,...e.relations.map(r=>r.target_id),...e.related_recommendations.flatMap(r=>[...(r.target_id?[r.target_id]:[]),...r.evidence.map(q=>q.entry_id)]),...(e.organization_proposal?.items||[]).flatMap(i=>[...(i.action==="record_relation"&&i.target_id?[i.target_id]:[]),...i.evidence.map(q=>q.entry_id)]),...(e.revision_of?[e.revision_of]:[])].filter(id=>!allIds.has(id)).map(id=>({entry_id:e.id,related_id:id})));
  for(const t of backup.topics)for(const id of [...t.representative_ids,...t.links.flatMap(l=>l.evidence.map(q=>q.entry_id))])if(!allIds.has(id))missingRelations.push({entry_id:t.id,related_id:id});
  const directory=await repo.topics(),currentPaths=new Set(topicPaths(directory.topics).values()),incomingPaths=topicPaths(backup.topics);
  return {count:backup.entries.length,history_count:backup.history.length,duplicates,missingAssets,missingRelations,personal_profile:!!backup.personal_profile,profile_conflict:!!backup.personal_profile&&!!await repo.readProfile?.(),topic_count:backup.topics.length,topic_conflicts:[...incomingPaths.values()].filter(p=>currentPaths.has(p))};
}
export async function importBackup(repo:Repository,backup:Backup,files:Record<string,Uint8Array>,replace:boolean){
  const preview=await previewImport(repo,backup,files);if(preview.missingAssets.length||preview.missingRelations.length)throw new AppError("存在缺失附件或关联记录，请补齐后导入");
  if(backup.entries.length>300)throw new AppError("单次导入最多 300 条记录，请分批导入");
  const existing=new Map((await repo.list()).map(e=>[e.id,e]));const selected=backup.entries.filter(e=>!existing.has(e.id)||replace);
  for(const e of selected)for(const a of e.attachments){const bytes=files[a.path];if(bytes){const old=await repo.readAsset(a.id);if(old){const oldBytes=new Uint8Array(await old.arrayBuffer());if(oldBytes.length!==bytes.length||oldBytes.some((b,i)=>b!==bytes[i]))throw new AppError(`附件 ID 已存在且内容不同：${a.name}，导入已停止`,409);}else await repo.putAsset(a.id,bytes,a.mime);}}
  const directory=await repo.topics(),incomingPaths=topicPaths(backup.topics);
  const topics=mergeTopicPaths(directory.topics,orderedTopics(backup.topics).map(t=>incomingPaths.get(t.id)!));
  const byPath=new Map([...topicPaths(topics)].map(([id,p])=>[p,id])),idMap=new Map(backup.topics.map(t=>[t.id,byPath.get(incomingPaths.get(t.id)!)!]));
  if(backup.schema_version>=3){
    // Preserve IDs in an empty restore; otherwise map by exact path, never by semantics.
    if(!directory.topics.length){topics.splice(0,topics.length,...structuredClone(backup.topics));for(const t of topics)idMap.set(t.id,t.id);}
    else for(const incoming of backup.topics){
      const target=topics.find(t=>t.id===idMap.get(incoming.id))!;
      const remappedLinks=incoming.links.map(l=>({...l,target_id:idMap.get(l.target_id)!}));
      if(!directory.topics.some(t=>t.id===target.id))Object.assign(target,topicSchema.parse({...incoming,id:target.id,parent_id:incoming.parent_id?idMap.get(incoming.parent_id)!:null,links:remappedLinks}));
      // Existing paths keep their definitions, aliases and links. Import preview names these conflicts.
    }
  }
  const remapItem=(i:OrganizationItem):OrganizationItem=>({...i,...(i.topic_id?{topic_id:idMap.get(i.topic_id)||i.topic_id}:{}),...(i.parent_id?{parent_id:idMap.get(i.parent_id)||i.parent_id}:{}),...(i.action==="topic_related"&&i.target_id?{target_id:idMap.get(i.target_id)||i.target_id}:{})});
  const remapEntry=(e:Entry):Entry=>entrySchema.parse({...e,topic_ids:e.topic_ids.map(id=>idMap.get(id)||id),related_recommendations:e.related_recommendations.map(remapItem),organization_proposal:e.organization_proposal?{...e.organization_proposal,items:e.organization_proposal.items.map(remapItem),...(e.organization_proposal.topic_context?{topic_context:Object.fromEntries(Object.entries(e.organization_proposal.topic_context).map(([id,t])=>[idMap.get(id)||id,{...t,parent_id:t.parent_id?idMap.get(t.parent_id)||t.parent_id:null}]))}:{})}:null});
  const changes=selected.map(e=>{const before=existing.get(e.id)||null;return {before,after:remapEntry({...e,version:before?Math.max(before.version,e.version)+1:e.version}),action:before?"确认替换导入":"备份恢复"};});
  // Pending suggestions remain stale after a merge import; only an empty restore is rebased.
  for(const c of changes)if(c.after.organization_proposal)c.after.organization_proposal.directory_revision=!existing.size&&!directory.topics.length?directory.revision+1:0;
  const selectedIds=new Set(selected.map(e=>e.id));const histories:History[]=backup.history.filter(h=>selectedIds.has(h.entry_id));
  const previousProfile=await repo.readProfile?.()||null;
  const profileChange=backup.personal_profile&&repo.readProfile&&(!previousProfile||replace)?{before:previousProfile,after:{...backup.personal_profile,version:(previousProfile?.version||0)+1,updated_at:new Date().toISOString()}}:undefined;
  await repo.commit(changes,"human",histories,{revision:directory.revision,topics},profileChange);return {imported:selected.length,skipped:backup.entries.length-selected.length};
}
