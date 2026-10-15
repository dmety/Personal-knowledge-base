import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeService } from "../lib/service";
import { organizeRecord } from "../lib/file-organization";
test('File moves preserve other memberships and history, remove and archive remain recoverable',async()=>{
 const repo=new MemoryRepository();repo.directory={revision:1,topics:mergeTopicPaths([],['AI / 求职','AI / 安全','项目'])};
 const before=blankEntry({title:'测试知识',content:'正文保留',topic_paths:['AI / 求职','项目'],tags:['独立标签']});repo.entries.set(before.id,before);
 const [source,target]=['求职','安全'].map(name=>repo.directory.topics.find(t=>t.name===name)!);
 const input={action:'organize' as const,id:before.id,version:before.version,revision:1,operation:'move' as const,source_topic_id:source.id,target_topic_id:target.id};
 const change=organizeRecord(before,repo.directory,input);await repo.commit([change],'human',[],repo.directory);
 assert.deepEqual((await repo.get(before.id)).topic_paths,['项目','AI / 安全']);assert.equal(repo.history[0].before?.content,'正文保留');assert.deepEqual(repo.history[0].before?.topic_paths,['AI / 求职','项目']);
 assert.throws(()=>organizeRecord(change.after,repo.directory,input),/已变化/);
 assert.throws(()=>organizeRecord(before,{...repo.directory,revision:2},input),/已变化/);
 assert.throws(()=>organizeRecord(before,repo.directory,{...input,target_topic_id:source.id}),/相同/);
 assert.throws(()=>organizeRecord(before,repo.directory,{...input,target_topic_id:'missing'}),/现有目标/);
 const removed=organizeRecord(change.after,repo.directory,{...input,version:change.after.version,operation:'remove',source_topic_id:target.id});assert.deepEqual(removed.after.topic_paths,['项目']);assert.deepEqual(removed.after.tags,['独立标签']);
 const archived=organizeRecord(change.after,repo.directory,{...input,version:change.after.version,operation:'archive',source_topic_id:target.id});assert.equal(archived.after.status,'archived');assert.deepEqual(archived.after.topic_paths,change.after.topic_paths);assert.equal(archived.after.content,'正文保留');
});
import { blankEntry, searchEntries, type Entry, type History } from "../lib/model";
import { makeBackup, zipBackup, parseBackup, previewImport, importBackup } from "../lib/backup";
import type { Repository } from "../lib/repository";
import { mergeTopicPaths, topicIdsForPaths, type Directory } from "../lib/topics";
class MemoryRepository implements Repository {
  entries=new Map<string,Entry>(); history:History[]=[]; assets=new Map<string,Uint8Array>();
  directory:Directory={revision:0,topics:[]};
  async readTopics(){return structuredClone(this.directory);}async topics(){this.directory.topics=mergeTopicPaths(this.directory.topics,(await this.list()).flatMap(e=>e.topic_paths));return this.readTopics();}
  async list(){return [...this.entries.values()].map(e=>structuredClone(e));}
  async get(id:string){const e=this.entries.get(id);if(!e)throw new Error("not found");return structuredClone(e);}
  async histories(){return structuredClone(this.history);}
  async commit(changes:{before:Entry|null;after:Entry;action:string}[],actor:"human"|"ai",extra:History[]=[],directory?:Directory){for(const c of changes){if(c.before)assert.equal(this.entries.get(c.before.id)?.version,c.before.version);}const snapshot=directory??this.directory;assert.equal(snapshot.revision,this.directory.revision);const topics=mergeTopicPaths(snapshot.topics,changes.flatMap(c=>c.after.topic_paths));this.directory={revision:this.directory.revision===0?1:snapshot.revision+(JSON.stringify(this.directory.topics)!==JSON.stringify(topics)?1:0),topics};for(const c of changes){c.after.topic_ids=topicIdsForPaths(c.after.topic_paths,topics);this.entries.set(c.after.id,structuredClone(c.after));this.history.push({id:crypto.randomUUID(),entry_id:c.after.id,at:new Date().toISOString(),actor,action:c.action,before:c.before,after:c.after});}this.history.push(...extra);}
  async readAsset(id:string){const bytes=this.assets.get(id);return bytes?{size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer,body:new Response(new Uint8Array(bytes).buffer).body} as R2ObjectBody:null;}
  async putAsset(id:string,b:Uint8Array){this.assets.set(id,b);}
  async lastExport(){return null;}async markExport(){}
}
test("AI writes drafts, review preserves original snapshot, stale suggestions fail",async()=>{
  const repo=new MemoryRepository(),s=new KnowledgeService(repo);const original=await s.create({title:"中文记录",content:"原文",tags:["学习"]});
  const reviewed=await s.update(original.id,{version:original.version,status:"reviewed"});
  const draft=await s.propose(original.id,"建议内容","补充证据");assert.equal((await repo.get(original.id)).content,"原文");assert.equal(draft.status,"draft");
  await s.review(draft.id,true,draft.version);assert.equal((await repo.get(original.id)).content,"建议内容");assert.equal((await repo.get(draft.id)).status,"archived");assert.ok(repo.history.some(h=>h.before?.content==="原文"&&h.after?.content==="建议内容"));
  const stale=await s.propose(original.id,"过期建议","测试");const current=await repo.get(original.id);await s.update(original.id,{version:current.version,content:"本人新编辑"});await assert.rejects(()=>s.review(stale.id,true,stale.version),/旧版本/);assert.equal((await repo.get(original.id)).content,"本人新编辑");
  const created=await s.create({title:"AI 新增",content:"草稿"},"ai");assert.equal(created.status,"draft");assert.equal(created.created_by,"ai");await assert.rejects(()=>s.update(created.id,{version:created.version,status:"reviewed"}),/审核/);
  await s.review(created.id,false,created.version);assert.equal((await repo.get(created.id)).status,"archived");assert.equal(reviewed.status,"reviewed");
});
test("Chinese search returns evidence, prioritizes reviewed and excludes archived",()=>{
  const entries=[blankEntry({id:"a",title:"学习方法",content:"主动回忆",status:"draft"}),blankEntry({id:"b",title:"笔记",content:"学习方法与主动回忆",status:"reviewed",source_url:"https://example.com/source",evidence:"原文证据"}),blankEntry({id:"c",title:"学习方法",content:"归档",status:"archived"})];
  const r=searchEntries(entries,"学习方法",{prefer_reviewed:"true"});assert.deepEqual(r.map(e=>e.id),["b","a"]);assert.ok(r[0].snippet.includes("主动回忆"));assert.equal(searchEntries(entries,"不存在的观点").length,0);
});
test("ZIP restores IDs, sources, history, relationships, PNG and PDF into an empty repository",async()=>{
  const repo=new MemoryRepository();const png=new Uint8Array([137,80,78,71,13,10,26,10,0]),pdf=new TextEncoder().encode("%PDF-1.4\n%%EOF");
  const a=blankEntry({id:"stable-a",title:"中文资料",content:"正文与链接",source_url:"https://example.com/reference",evidence:"具体摘录",tags:["中文主题"],attachments:[{id:"png-1",name:"图.png",mime:"image/png",size:png.length,path:"assets/png-1"},{id:"pdf-1",name:"文档.pdf",mime:"application/pdf",size:pdf.length,path:"assets/pdf-1"}]});const b=blankEntry({id:"stable-b",title:"关联想法",content:"想法",related_ids:[a.id]});await repo.commit([{before:null,after:a,action:"创建"},{before:null,after:b,action:"创建"}],"human");await repo.putAsset("png-1",png);await repo.putAsset("pdf-1",pdf);
  const backup=await makeBackup(repo),zip=await zipBackup(repo,backup),parsed=parseBackup(zip,true),empty=new MemoryRepository();const preview=await previewImport(empty,parsed.backup,parsed.files);assert.equal(preview.count,2);assert.equal(preview.missingAssets.length,0);await importBackup(empty,parsed.backup,parsed.files,false);assert.deepEqual(await empty.get(a.id),a);assert.deepEqual((await empty.get(b.id)).related_ids,[a.id]);assert.deepEqual(empty.assets.get("png-1"),png);assert.deepEqual(empty.assets.get("pdf-1"),pdf);assert.ok(empty.history.some(h=>h.id===repo.history[0].id));
  const duplicates=await previewImport(empty,parsed.backup,parsed.files);assert.equal(duplicates.duplicates.length,2);assert.equal((await importBackup(empty,parsed.backup,parsed.files,false)).skipped,2);await importBackup(empty,parsed.backup,parsed.files,true);assert.ok(empty.history.some(h=>h.action==="确认替换导入"&&h.before?.id===a.id));
  const without=parseBackup(new TextEncoder().encode(JSON.stringify(backup)),false);assert.equal((await previewImport(new MemoryRepository(),without.backup,without.files)).missingAssets.length,2);
});

test("Network suggestions require review, preserve versions, and reject missing targets",async()=>{
 const repo=new MemoryRepository(),service=new KnowledgeService(repo);
 const target=await service.create({title:'Vue 基础',content:'来源内容'});const base=await service.create({title:'状态管理',content:'正文'});const reviewed=await service.update(base.id,{version:1,status:'reviewed'});
 await repo.commit([],"human",[],{revision:(await repo.topics()).revision,topics:mergeTopicPaths((await repo.topics()).topics,['前端开发 / Vue / 状态管理','其他主题'])});
 const suggestion=await service.propose(base.id,base.content,'根据 Vue 基础提出依赖建议',[],{topic_paths:['前端开发/Vue/状态管理'],relations:[{target_id:target.id,kind:'depends_on',note:'状态管理使用 Vue 响应式基础'}]});
 assert.equal((await repo.get(base.id)).relations.length,0);assert.equal(suggestion.status,'draft');assert.deepEqual(suggestion.topic_paths,['前端开发 / Vue / 状态管理']);
 await service.review(suggestion.id,true,1);const saved=await repo.get(base.id);assert.equal(saved.relations[0].target_id,target.id);assert.equal(saved.version,reviewed.version+1);assert.ok(repo.history.some(h=>h.before?.id===base.id&&h.before.relations.length===0&&h.after?.relations.length===1));
 const stale=await service.propose(base.id,saved.content,'旧建议',[],{topic_paths:['其他主题']});await service.update(base.id,{version:saved.version,notes:'更新'});await assert.rejects(()=>service.review(stale.id,true,1),/旧版本/);
 await assert.rejects(()=>service.update(base.id,{version:4,relations:[{target_id:base.id,kind:'contrast',note:''}]}),/自己/);
 await assert.rejects(()=>service.create({title:'错误关系',relations:[{target_id:'missing',kind:'example',note:''}]}));
 const backup=await makeBackup(repo);const parsed=parseBackup(await zipBackup(repo,backup),true);const empty=new MemoryRepository();await importBackup(empty,parsed.backup,parsed.files,false);assert.deepEqual((await empty.get(base.id)).relations,(await repo.get(base.id)).relations);assert.deepEqual((await empty.get(base.id)).topic_paths,(await repo.get(base.id)).topic_paths);
 const broken={...backup,entries:backup.entries.map(e=>e.id===base.id?{...e,relations:[{target_id:'missing',kind:'example' as const,note:''}]}:e)};assert.ok((await previewImport(empty,broken,{})).missingRelations.some(r=>r.related_id==='missing'));
});
import { topicTree, selectNetwork } from '../lib/network';
import { entrySchema } from '../lib/model';
import { changeDirectory, directoryItems, topicPaths, orderedTopics } from '../lib/topics';
test('Persistent directory migrates paths, deduplicates counts and validates moves',async()=>{
 const repo=new MemoryRepository();const a=blankEntry({title:'多主题记录',topic_paths:['前端 / Vue','前端 / React'],tags:['Seed']}),b=blankEntry({title:'归档',topic_paths:['前端 / Vue'],status:'archived'});await repo.commit([{before:null,after:a,action:'创建'},{before:null,after:b,action:'创建'}],'human');
 let d=await repo.topics();assert.equal(d.topics.length,3);assert.equal((await repo.topics()).topics.length,3);assert.equal(directoryItems(d.topics,await repo.list()).find(t=>t.name==='前端')!.count,1);assert.ok(!d.topics.some(t=>t.name==='Seed'));
 const root=d.topics.find(t=>t.name==='前端')!,vue=d.topics.find(t=>t.name==='Vue')!;
 assert.throws(()=>changeDirectory(d,[],{action:'move',id:root.id,parent_id:vue.id,revision:d.revision}),/自身或后代/);
 assert.throws(()=>changeDirectory(d,[],{action:'create',name:'Vue',parent_id:root.id,revision:d.revision}),/重复/);
 assert.throws(()=>changeDirectory(d,[],{action:'delete',id:root.id,revision:d.revision}),/子主题/);
 const renamed=changeDirectory(d,await repo.list(),{action:'rename',id:root.id,name:'技术',revision:d.revision});await repo.commit(renamed.changes,'human',[],{revision:d.revision,topics:renamed.topics});
 assert.deepEqual((await repo.get(a.id)).topic_paths,['技术 / Vue','技术 / React']);assert.equal((await repo.get(b.id)).topic_paths[0],'技术 / Vue');assert.ok(repo.history.some(h=>h.before?.topic_paths.includes('前端 / Vue')&&h.after?.topic_paths.includes('技术 / Vue')));
 assert.throws(()=>changeDirectory(d,[],{action:'move',id:vue.id,revision:d.revision-1}),/已变化/);
 d=await repo.topics();const empty=changeDirectory(d,await repo.list(),{action:'create',name:'空主题',revision:d.revision});await repo.commit([],'human',[],{revision:d.revision,topics:empty.topics});d=await repo.topics();assert.equal(directoryItems(d.topics,await repo.list()).find(t=>t.name==='空主题')!.count,0);
 const deleted=changeDirectory(d,await repo.list(),{action:'delete',id:empty.node_id,revision:d.revision});assert.ok(!deleted.topics.some(t=>t.name==='空主题'));
});
test('Directory limits depth, preserves stable IDs and supports sibling reordering',()=>{
 const topics=mergeTopicPaths([],['一 / 二 / 三 / 四 / 五','另一根']);const d={revision:1,topics},fifth=topics.find(t=>t.name==='五')!;
 assert.throws(()=>changeDirectory(d,[],{action:'create',name:'六',parent_id:fifth.id,revision:1}),/五层/);
 const root=topics.find(t=>t.name==='一')!,other=topics.find(t=>t.name==='另一根')!;
 assert.throws(()=>changeDirectory(d,[],{action:'move',id:root.id,parent_id:other.id,revision:1}),/五层/);
 const moved=changeDirectory(d,[],{action:'move',id:other.id,parent_id:null,anchor_id:root.id,placement:'before',revision:1});assert.equal(orderedTopics(moved.topics)[0].id,other.id);assert.equal(topicPaths(moved.topics).get(fifth.id),'一 / 二 / 三 / 四 / 五');
});
test('v2 backup restores empty directory and order; v1 paths migrate without classifying tags',async()=>{
 const repo=new MemoryRepository();repo.directory={revision:1,topics:mergeTopicPaths([],['乙 / 空子主题','甲'])};repo.directory.topics.find(t=>t.name==='乙')!.position=1;repo.directory.topics.find(t=>t.name==='甲')!.position=0;
 const latest=await makeBackup(repo);assert.equal(latest.schema_version,3);const backup={...latest,schema_version:2 as const};const parsed=parseBackup(await zipBackup(repo,backup),true),target=new MemoryRepository();await importBackup(target,parsed.backup,parsed.files,false);
 assert.deepEqual(orderedTopics((await target.topics()).topics).map(t=>t.name),['甲','乙','空子主题']);assert.ok(!(await target.topics()).topics.some(t=>backup.topics.some(b=>b.id===t.id)));
 const old=blankEntry({title:'旧记录',topic_paths:['旧 / 子'],tags:['标签']});const v1={format:'zhixu-backup',schema_version:1,exported_at:new Date().toISOString(),entries:[old],history:[]};const migrated=parseBackup(new TextEncoder().encode(JSON.stringify(v1)),false);assert.equal(migrated.backup.topics.length,2);
 const invalid=structuredClone(backup);invalid.topics[0].parent_id=invalid.topics[0].id;assert.throws(()=>parseBackup(new TextEncoder().encode(JSON.stringify(invalid)),false),/自身或后代/);
 invalid.topics[0].parent_id='missing';assert.throws(()=>parseBackup(new TextEncoder().encode(JSON.stringify(invalid)),false),/父节点/);
 const conflicts=await previewImport(repo,backup,{});assert.equal(conflicts.topic_conflicts.length,3);
 assert.equal(searchEntries([old,blankEntry({title:'无主题',tags:['标签']})],'',{unclassified:'true'}).length,1);
});
test('Legacy records and hierarchical, bidirectional graph neighborhoods',()=>{
 const a=blankEntry({id:'a',title:'基础',topic_paths:['前端 / Vue'],relations:[{target_id:'b',kind:'supplement',note:''}]});const b=blankEntry({id:'b',title:'应用',relations:[{target_id:'c',kind:'example',note:''}]});const c=blankEntry({id:'c',title:'案例'});const archived=blankEntry({id:'d',title:'归档',status:'archived',relations:[{target_id:'a',kind:'contrast',note:''}]});
 assert.deepEqual(topicTree([a,b]),['前端','前端 / Vue']);assert.deepEqual(selectNetwork([a,b,c,archived],'a','',1,'','').nodes.map(e=>e.id),['a','b']);assert.equal(selectNetwork([a,b,c,archived],'a','',2,'','').nodes.length,3);assert.equal(selectNetwork([a,b,c],'b','',1,'','').nodes.length,3);
 const legacy:any={...a};delete legacy.topic_paths;delete legacy.relations;const normalized=entrySchema.parse(legacy);assert.deepEqual(normalized.topic_paths,[]);assert.deepEqual(normalized.relations,[]);assert.equal(searchEntries([a],'Vue').length,1);
});

import { buildKnowledgeGraph } from '../lib/network';
test('Knowledge graph includes hierarchy, empty topics, memberships and approved topic links',()=>{
 const topics=mergeTopicPaths([],['技术 / Vue','技术 / React','空主题']);
 const vue=topics.find(t=>t.name==='Vue')!,react=topics.find(t=>t.name==='React')!;
 vue.links=[{target_id:react.id,note:'框架对比',strength:'strong',basis:'inference',evidence:[]}];
 const a=blankEntry({id:'a',title:'多主题记录',topic_paths:['技术 / Vue','技术 / React']});
 const b=blankEntry({id:'b',title:'推荐目标'});
 a.related_recommendations=[{id:'rec',action:'record_relation',target_id:'b',reason:'推荐依据',strength:'weak',basis:'inference',evidence:[],decision:'accepted',feedback:''}];
 const copy=blankEntry({id:'copy',title:'修改建议',revision_of:'a'});
 const opts={focus:'',topic:'',depth:1,status:'',query:'',mode:'topics' as const,recommendations:false,hideIsolated:false};
 const directory=directoryItems(topics,[a,b,copy]);const graph=buildKnowledgeGraph([a,b,copy],directory,opts);
 assert.equal(graph.nodes.filter(n=>n.type==='topic').length,4);assert.ok(graph.nodes.some(n=>n.title==='空主题'));assert.ok(!graph.nodes.some(n=>n.id==='copy'));
 assert.equal(graph.edges.filter(e=>e.category==='hierarchy').length,2);assert.equal(graph.edges.filter(e=>e.category==='membership').length,2);assert.equal(graph.edges.filter(e=>e.category==='topic_link').length,1);
 assert.equal(graph.edges.filter(e=>e.category==='recommendation').length,0);
 const recommended=buildKnowledgeGraph([a,b],directory,{...opts,mode:'records',focus:'a',recommendations:true});assert.ok(recommended.nodes.some(n=>n.id==='b'));assert.equal(recommended.edges.length,1);assert.equal(recommended.edges[0].category,'recommendation');
 const branch=buildKnowledgeGraph([a,b],directory,{...opts,topic:'技术 / Vue'});assert.ok(branch.nodes.some(n=>n.title==='技术'));assert.ok(!branch.nodes.some(n=>n.title==='空主题'));
 const isolated=buildKnowledgeGraph([a,b],directory,{...opts,hideIsolated:true});assert.ok(!isolated.nodes.some(n=>n.title==='空主题'));assert.ok(isolated.nodes.some(n=>n.id==='a'));
});
test('Center record survives truncation; hidden relation endpoints are reported',()=>{
 const records=Array.from({length:65},(_,i)=>blankEntry({id:'r'+i,title:'记录'+i,relations:i?[]:[{target_id:'r64',kind:'example',note:'已有关联'}]}));
 const opts={focus:'',topic:'',depth:1,status:'',query:'',mode:'records' as const,recommendations:false,hideIsolated:false};
 const graph=buildKnowledgeGraph(records,[],opts);assert.equal(graph.nodes.length,60);assert.equal(graph.total,65);assert.equal(graph.hiddenEdges,1);
 records[64].related_ids=records.slice(0,64).map(e=>e.id);
 const center=buildKnowledgeGraph(records,[],{...opts,focus:'r64'});assert.equal(center.nodes[0].id,'r64');assert.equal(center.nodes.length,60);assert.ok(center.edges.length>0);
});
