import test from "node:test";
import assert from "node:assert/strict";
import { blankEntry, entrySchema, searchEntries, type Entry, type History } from "../lib/model";
import { OrganizationService, directoryContext, organizationCandidates } from "../lib/organization";
import { KnowledgeService } from "../lib/service";
import { topicPaths, topicIdsForPaths, mergeTopicPaths, changeDirectory, directoryItems, knowledgeRecords, unclassifiedCount, type Directory } from "../lib/topics";
import { makeBackup, parseBackup, importBackup } from "../lib/backup";
import type { Repository } from "../lib/repository";
class FixtureRepository implements Repository{
  records=new Map<string,Entry>();directory:Directory={revision:0,topics:[]};history:History[]=[];
  async list(){return structuredClone([...this.records.values()]);}async get(id:string){const e=this.records.get(id);if(!e)throw Error("missing");return structuredClone(e);}
  async readTopics(){return structuredClone(this.directory);}async topics(){return this.readTopics();}async histories(){return structuredClone(this.history);}
  async commit(changes:{before:Entry|null;after:Entry;action:string}[],actor:"human"|"ai",extra:History[]=[],directory?:Directory){
    const snapshot=directory??this.directory;assert.equal(snapshot.revision,this.directory.revision);
    for(const c of changes)if(c.before)assert.equal(this.records.get(c.after.id)?.version,c.before.version);
    if(actor==="ai")assert.ok(changes.every(c=>c.after.topic_paths.every(p=>[...topicPaths(snapshot.topics).values()].includes(p))));
    const topics=mergeTopicPaths(snapshot.topics,changes.flatMap(c=>c.after.topic_paths));
    this.directory={revision:this.directory.revision===0?1:snapshot.revision+(JSON.stringify(topics)!==JSON.stringify(this.directory.topics)?1:0),topics};
    for(const c of changes){c.after.topic_ids=topicIdsForPaths(c.after.topic_paths,topics);this.records.set(c.after.id,structuredClone(c.after));this.history.push({id:crypto.randomUUID(),entry_id:c.after.id,at:new Date().toISOString(),actor,action:c.action,before:c.before,after:c.after});}this.history.push(...extra);
  }
  async readAsset(){return null;}async putAsset(){}async lastExport(){return null;}async markExport(){}
}
async function fixture(paths=["学习 / 记忆","学习 / 实践","项目 / 时间管理"]){
  const repo=new FixtureRepository();await repo.commit([],"human",[],{revision:0,topics:mergeTopicPaths([],paths)});
  const service=new KnowledgeService(repo),organization=new OrganizationService(repo);
  const base=await service.create({title:"间隔复习与主动回忆",content:"间隔复习是在不同时间重复学习。主动回忆可以配合间隔复习。复盘适用于项目实践。"});
  const target=await service.create({title:"主动回忆",content:"主动回忆要求不看答案回想。它可以和间隔复习结合。"});
  const directory=await repo.topics(),memory=directory.topics.find(t=>t.name==="记忆")!;
  return {repo,service,organization,base,target,directory,memory};
}
const quote=(entry:Entry)=>({entry_id:entry.id,quote:entry.content.slice(0,20),field:"content" as const});
test("AI must reuse existing IDs; unknown paths never create topics",async()=>{
  const f=await fixture();const before=await f.repo.topics();
  await assert.rejects(()=>f.service.create({title:"AI",content:"资料",topic_paths:["新词"]},"ai"),/不能直接创建主题/);
  assert.deepEqual(await f.repo.topics(),before);
  const e=await f.service.create({title:"AI",content:"资料",topic_ids:[f.memory.id]},"ai");assert.deepEqual(e.topic_paths,["学习 / 记忆"]);
  await assert.rejects(()=>f.service.create({title:"AI",content:"资料",topic_ids:["missing"]},"ai"),/不存在/);
});
test("Organization suggestions deduplicate and review one item without changing content or status",async()=>{
  const f=await fixture();const input={entry_id:f.base.id,entry_version:f.base.version,directory_revision:f.directory.revision,items:[{action:"classify",topic_id:f.memory.id,reason:"讨论记忆方法",evidence:[quote(f.base)]},{action:"alias",topic_id:f.memory.id,name:"记忆方法",reason:"作为本库记忆主题的别名",evidence:[quote(f.base)]}]};
  let proposal=await f.organization.propose(input);const duplicate=await f.organization.propose(input);assert.equal(proposal.id,duplicate.id);assert.deepEqual((await f.repo.topics()).topics,f.directory.topics);
  assert.equal(searchEntries(await f.repo.list(),"整理建议").length,0);
  await assert.rejects(()=>f.service.review(proposal.id,true,proposal.version),/逐项/);
  let result=await f.organization.review(proposal.id,proposal.organization_proposal!.items[0].id,true,proposal.version);
  assert.equal(result.base.content,f.base.content);assert.equal(result.base.status,"inbox");assert.deepEqual(result.base.topic_ids,[f.memory.id]);assert.equal(result.entry.status,"draft");
  proposal=result.entry;result=await f.organization.review(proposal.id,proposal.organization_proposal!.items[1].id,true,proposal.version,"本库采用此叫法");
  assert.equal(result.entry.status,"archived");assert.ok((await f.repo.topics()).topics.find(t=>t.id===f.memory.id)!.aliases.includes("记忆方法"));
  const context=directoryContext(await f.repo.topics(),await f.repo.list(),"记忆方法");assert.equal(context.topics[0].id,f.memory.id);assert.equal(context.topics[0].match,"exact");
});
test("New themes are suggestions only; rejection feedback is returned to future analysis",async()=>{
  const f=await fixture();const p=await f.organization.propose({entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[{action:"new_topic",name:"复盘",parent_id:f.directory.topics.find(t=>t.name==="项目")!.id,definition:"项目结束后对过程进行检视，区别于记忆方法",reason:"资料讨论项目实践",evidence:[quote(f.base)]}]});
  assert.ok(!(await f.repo.topics()).topics.some(t=>t.name==="复盘"));
  await f.organization.review(p.id,p.organization_proposal!.items[0].id,false,p.version,"已有实践主题可以容纳");
  assert.equal((await f.repo.get(f.base.id)).version,1);assert.ok(!(await f.repo.topics()).topics.some(t=>t.name==="复盘"));
  assert.equal(organizationCandidates(await f.repo.topics(),await f.repo.list(),f.base,["复盘"]).feedback[0].feedback,"已有实践主题可以容纳");
});
test("Weak related recommendations stay separate from formal relations; strong requires both sources",async()=>{
  const f=await fixture();const input={entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[{action:"record_relation",target_id:f.target.id,strength:"weak",basis:"inference",reason:"都讨论记忆",evidence:[quote(f.base),quote(f.target)]}]};
  const p=await f.organization.propose(input);await f.organization.review(p.id,p.organization_proposal!.items[0].id,true,p.version);let base=await f.repo.get(f.base.id);assert.equal(base.relations.length,0);assert.equal(base.related_recommendations.length,1);
  await assert.rejects(()=>f.organization.propose({...input,entry_version:base.version,items:[{...input.items[0],strength:"strong"}]}),/具体关系类型/);
  await assert.rejects(()=>f.organization.propose({...input,entry_version:base.version,items:[{...input.items[0],strength:"strong",kind:"supplement",evidence:[quote(f.base)]}]}),/目标记录/);
  const strong=await f.organization.propose({...input,entry_version:base.version,items:[{...input.items[0],strength:"strong",kind:"supplement"}]});
  await f.organization.review(strong.id,strong.organization_proposal!.items[0].id,true,strong.version);base=await f.repo.get(f.base.id);assert.equal(base.relations[0].kind,"supplement");assert.ok(base.relations[0].note.includes("AI 推断"));
});
test("Changed evidence is blocked, but unrelated directory changes do not block review",async()=>{
  const f=await fixture();const item={action:"record_relation",target_id:f.target.id,reason:"关联",evidence:[quote(f.base),quote(f.target)]};const input={entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[item]};
  await assert.rejects(()=>f.organization.propose({...input,items:[{...item,evidence:[{entry_id:f.base.id,quote:"没有这句话"}]}]}));
  const p=await f.organization.propose(input);await f.service.update(f.target.id,{version:1,notes:"新增"});await assert.rejects(()=>f.organization.review(p.id,p.organization_proposal!.items[0].id,true,p.version),/依据记录已更新/);
  const classify=await f.organization.propose({...input,items:[{action:"classify",topic_id:f.memory.id,reason:"属于记忆",evidence:[quote(f.base)]}]});
  const d=await f.repo.topics();const change=changeDirectory(d,await f.repo.list(),{action:"create",name:"新目录",revision:d.revision});await f.repo.commit([],"human",[],{revision:d.revision,topics:change.topics});
  await f.organization.review(classify.id,classify.organization_proposal!.items[0].id,true,classify.version);
  assert.deepEqual((await f.repo.get(f.base.id)).topic_ids,[f.memory.id]);
  await f.organization.review(p.id,p.organization_proposal!.items[0].id,false,p.version,"拒绝过期建议");
});
test("Four knowledge records remain four when six organization proposals and content revisions exist",async()=>{
  const f=await fixture();
  await f.service.create({title:"第三条",content:"第三条"});
  const fourth=await f.service.create({title:"第四条",content:"第四条",topic_paths:["学习 / 记忆"]});
  for(let i=0;i<6;i++)await f.organization.propose({entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[{action:"classify",topic_id:f.memory.id,reason:`建议${i}`,evidence:[quote(f.base)]}]});
  await f.service.propose(fourth.id,"正文修改建议","修订",[],{});
  const entries=await f.repo.list();
  assert.equal(knowledgeRecords(entries).length,4);assert.equal(unclassifiedCount(entries),3);
  assert.equal(searchEntries(entries,"",{unclassified:"true",status:"draft"}).length,0);
  assert.equal(directoryItems((await f.repo.topics()).topics,entries).find(t=>t.id===f.memory.id)!.count,1);
});
test("Separate same-name proposals reuse the first accepted theme and metadata changes do not stale evidence",async()=>{
  const f=await fixture(),item={action:"new_topic",name:"求职",definition:"招聘与简历准备",scope:"实习信息",reason:"主题不同",evidence:[quote(f.base)]};
  const p=await f.organization.propose({entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[item]});
  const q=await f.organization.propose({entry_id:f.target.id,entry_version:1,directory_revision:f.directory.revision,items:[{...item,evidence:[quote(f.target)]},{action:"record_relation",target_id:f.base.id,reason:"搭配阅读",evidence:[quote(f.target),quote(f.base)]}]});
  // Exercise legacy proposals created before topic snapshots were introduced.
  delete f.repo.records.get(q.id)!.organization_proposal!.topic_context;
  await f.organization.review(p.id,p.organization_proposal!.items[0].id,true,p.version);
  assert.deepEqual(await f.organization.assess(await f.repo.get(q.id)),{});
  let result=await f.organization.review(q.id,q.organization_proposal!.items[0].id,true,q.version);
  assert.equal(result.entry.organization_proposal!.items[0].action,"classify");
  result=await f.organization.review(q.id,q.organization_proposal!.items[1].id,true,result.entry.version);
  const topics=(await f.repo.topics()).topics.filter(t=>t.name==="求职");assert.equal(topics.length,1);
  assert.deepEqual(result.base.topic_ids,(await f.repo.get(f.base.id)).topic_ids);
});
test("Changing a referenced theme meaning or creating a conflicting same-name theme blocks only affected items",async()=>{
  const f=await fixture();
  const p=await f.organization.propose({entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[{action:"classify",topic_id:f.memory.id,reason:"记忆",evidence:[quote(f.base)]},{action:"record_relation",target_id:f.target.id,reason:"阅读",evidence:[quote(f.base),quote(f.target)]}]});
  const d=await f.repo.topics();d.topics.find(t=>t.id===f.memory.id)!.definition="新的主题含义";await f.repo.commit([],"human",[],d);
  assert.ok((await f.organization.assess(p))[p.organization_proposal!.items[0].id]);
  assert.equal((await f.organization.assess(p))[p.organization_proposal!.items[1].id],undefined);
  await assert.rejects(()=>f.organization.review(p.id,p.organization_proposal!.items[0].id,true,p.version),/含义已变化/);
  const rejected=await f.organization.review(p.id,p.organization_proposal!.items[0].id,false,p.version);
  await f.organization.review(p.id,p.organization_proposal!.items[1].id,true,rejected.entry.version);
  const base=await f.repo.get(f.base.id),dir=await f.repo.topics();
  const q=await f.organization.propose({entry_id:base.id,entry_version:base.version,directory_revision:dir.revision,items:[{action:"new_topic",name:"新概念",definition:"含义A",reason:"独立",evidence:[quote(base)]}]});
  const change=changeDirectory(dir,await f.repo.list(),{action:"create",name:"新概念",definition:"含义B",revision:dir.revision});await f.repo.commit([],"human",[],{revision:dir.revision,topics:change.topics});
  await assert.rejects(()=>f.organization.review(q.id,q.organization_proposal!.items[0].id,true,q.version),/定义或范围不同/);
});
test("v3 backup preserves aliases, IDs, pending suggestions and evidence across empty restore",async()=>{
  const f=await fixture();const d=await f.repo.topics();d.topics.find(t=>t.id===f.memory.id)!.aliases=["记忆方法"];await f.repo.commit([],"human",[],d);
  const directory=await f.repo.topics();const p=await f.organization.propose({entry_id:f.base.id,entry_version:1,directory_revision:directory.revision,items:[{action:"classify",topic_id:f.memory.id,reason:"记忆方法",evidence:[quote(f.base)]}]});
  const backup=await makeBackup(f.repo),parsed=parseBackup(new TextEncoder().encode(JSON.stringify(backup)),false),target=new FixtureRepository();await importBackup(target,parsed.backup,{},false);
  assert.ok((await target.topics()).topics.find(t=>t.id===f.memory.id)!.aliases.includes("记忆方法"));
  const restored=await target.get(p.id);await new OrganizationService(target).review(restored.id,restored.organization_proposal!.items[0].id,true,restored.version);assert.deepEqual((await target.get(f.base.id)).topic_ids,[f.memory.id]);
});
test("Empty topics and unrelated vocabularies use the same candidate pipeline",async()=>{
  for(const [paths,term] of [[['技术 / Vue','技术 / React'],'Vue'],[['历史 / 唐代','历史 / 宋代'],'唐代'],[['学习 / 记忆','学习 / 实践'],'记忆']] as const){
    const f=await fixture([...paths]);const result=organizationCandidates(await f.repo.topics(),await f.repo.list(),f.base,[term]);assert.equal(result.topics[0].name,term);assert.equal(result.topics[0].representatives.length,0);
  }
  const legacy:any=blankEntry({title:"旧笔记"});delete legacy.topic_ids;delete legacy.organization_proposal;assert.deepEqual(entrySchema.parse(legacy).topic_ids,[]);
});
test("Accepted new theme and cross-topic link rebase remaining items and survive mapped restore",async()=>{
  const f=await fixture(),other=f.directory.topics.find(t=>t.name==="时间管理")!,parent=f.directory.topics.find(t=>t.name==="项目")!;
  let p=await f.organization.propose({entry_id:f.base.id,entry_version:1,directory_revision:f.directory.revision,items:[{action:"new_topic",name:"复盘",parent_id:parent.id,definition:"项目结束后检视过程",reason:"不同于记忆方法",evidence:[quote(f.base)]},{action:"topic_related",topic_id:f.memory.id,target_id:other.id,strength:"weak",basis:"inference",reason:"复习计划需要安排时间",evidence:[quote(f.base)]}]});
  p=(await f.organization.review(p.id,p.organization_proposal!.items[0].id,true,p.version)).entry;
  const created=(await f.repo.topics()).topics.find(t=>t.name==="复盘")!;assert.ok(created);assert.ok((await f.repo.get(f.base.id)).topic_ids.includes(created.id));
  p=(await f.organization.review(p.id,p.organization_proposal!.items[1].id,true,p.version)).entry;assert.equal(p.status,"archived");assert.equal((await f.repo.topics()).topics.find(t=>t.id===f.memory.id)!.links[0].target_id,other.id);
  const backup=await makeBackup(f.repo),target=new FixtureRepository();await target.commit([],"human",[],{revision:0,topics:mergeTopicPaths([],["学习 / 记忆"])});await importBackup(target,backup,{},false);
  const restored=await target.get(f.base.id),d=await target.topics();assert.ok(restored.topic_ids.every(id=>d.topics.some(t=>t.id===id)));assert.equal((await target.get(p.id)).organization_proposal!.directory_revision,0);
});
test("Backup retries record changes even when directory revision is unchanged",async()=>{
  const f=await fixture();const originalHistories=f.repo.histories.bind(f.repo);let changed=false;
  f.repo.histories=async()=>{if(!changed){changed=true;const before=await f.repo.get(f.base.id);await f.repo.commit([{before,after:{...before,version:before.version+1,content:"并发修改后的内容"},action:"并发编辑"}],"human");}return originalHistories();};
  const backup=await makeBackup(f.repo);assert.equal(backup.entries.find(e=>e.id===f.base.id)!.content,"并发修改后的内容");assert.equal((await f.repo.topics()).revision,f.directory.revision);
});
