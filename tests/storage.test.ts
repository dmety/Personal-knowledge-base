import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { env } from "./worker-env";
import { D1Repository } from "../lib/repository";
import { blankEntry } from "../lib/model";
import { makeBackup, zipBackup, parseBackup, importBackup } from "../lib/backup";
import { changeDirectory, topicPaths, mergeTopicPaths } from "../lib/topics";
import { KnowledgeService } from "../lib/service";
import { OrganizationService } from "../lib/organization";
test("Real D1 transaction guard, owner isolation and ZIP restoration into empty D1/R2",async()=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:"2026-05-15",d1Databases:["DB"],r2Buckets:["BUCKET"],cf:false});
  try{
    env.DB=await mf.getD1Database("DB") as unknown as D1Database;env.BUCKET=await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
    for(const file of ["0000_sleepy_logan.sql","0001_fancy_hellcat.sql","0002_capture_references.sql","0003_personal_profiles.sql"]){const sql=await readFile("drizzle/"+file,"utf8");for(const statement of sql.split("--> statement-breakpoint").filter(s=>s.trim()))await env.DB.prepare(statement).run();}
    const source=new D1Repository("fixture-source"),target=new D1Repository("fixture-restored");
    const png=new Uint8Array([137,80,78,71,13,10,26,10,0]),pdf=new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const a=blankEntry({id:"stable-a",title:"中文资料",content:"原文",source_url:"https://example.com/source",tags:["中文"],status:"reviewed",attachments:[{id:"png",name:"图片.png",mime:"image/png",size:png.length,path:"assets/png"},{id:"pdf",name:"资料.pdf",mime:"application/pdf",size:pdf.length,path:"assets/pdf"}]}),b=blankEntry({id:"stable-b",title:"关联记录",content:"想法",related_ids:[a.id]});
    await source.commit([{before:null,after:a,action:"创建"},{before:null,after:b,action:"创建"}],"human");await source.putAsset("png",png,"image/png");await source.putAsset("pdf",pdf,"application/pdf");
    assert.equal((await target.list()).length,0);assert.equal(await target.readAsset("png"),null);
    const legacy={...blankEntry({id:"legacy-record",title:"上线前的旧笔记",content:"旧正文",status:"reviewed"})} as Record<string,unknown>;delete legacy.topic_paths;delete legacy.relations;
    await env.DB.prepare("INSERT INTO entries(owner,id,version,data) VALUES(?,?,?,?)").bind("fixture-source","legacy-record",1,JSON.stringify(legacy)).run();
    const oldDetail=await source.get("legacy-record");assert.deepEqual(oldDetail.topic_paths,[]);assert.deepEqual(oldDetail.relations,[]);assert.equal(oldDetail.content,"旧正文");
    const updated={...a,content:"本人编辑",version:2};await source.commit([{before:a,after:updated,action:"编辑"}],"human");
    await assert.rejects(()=>source.commit([{before:a,after:{...a,content:"过期覆盖",version:2},action:"应失败"}],"human"),/记录已变化/);assert.equal((await source.get(a.id)).content,"本人编辑");assert.equal((await source.histories(a.id)).length,2);
    const backup=await makeBackup(source),packed=await zipBackup(source,backup),parsed=parseBackup(packed,true);await importBackup(target,parsed.backup,parsed.files,false);
    assert.deepEqual(await target.get(a.id),updated);assert.deepEqual(await target.get(b.id),b);assert.deepEqual(new Uint8Array(await (await target.readAsset("png"))!.arrayBuffer()),png);assert.deepEqual(new Uint8Array(await (await target.readAsset("pdf"))!.arrayBuffer()),pdf);assert.ok((await target.histories()).some(h=>h.id===backup.history[0].id));
    const tagged=blankEntry({id:"topic-record",title:"迁移测试",topic_paths:["原主题 / 子主题"],tags:["不分类"]});await source.commit([{before:null,after:tagged,action:"创建"}],"human");let directory=await source.topics();assert.equal(directory.topics.length,2);assert.deepEqual((await target.topics()).topics,[]);
    const root=directory.topics.find(t=>t.name==="原主题")!,renamed=changeDirectory(directory,await source.list(),{action:"rename",id:root.id,name:"新主题",revision:directory.revision});await source.commit(renamed.changes,"human",[],{revision:directory.revision,topics:renamed.topics});assert.equal((await source.get(tagged.id)).topic_paths[0],"新主题 / 子主题");
    await assert.rejects(()=>source.commit([],"human",[],directory),/已变化/);assert.ok((await source.histories(tagged.id)).some(h=>h.before?.topic_paths[0]==="原主题 / 子主题"&&h.after?.topic_paths[0]==="新主题 / 子主题"));
    directory=await source.topics();const concurrent=await Promise.allSettled(["并发甲","并发乙"].map(name=>{const result=changeDirectory(directory,[],{action:"create",name,revision:directory.revision});return source.commit([],"human",[],{revision:directory.revision,topics:result.topics});}));assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
    directory=await source.topics();const stale=(await source.get(tagged.id)),change=changeDirectory(directory,await source.list(),{action:"rename",id:root.id,name:"最终主题",revision:directory.revision});change.changes[0].before={...stale,version:1};await assert.rejects(()=>source.commit(change.changes,"human",[],{revision:directory.revision,topics:change.topics}),/已变化/);assert.ok([...topicPaths((await source.topics()).topics).values()].includes("新主题"));assert.equal((await source.get(tagged.id)).topic_paths[0],"新主题 / 子主题");
    const old=blankEntry({id:"path-only",title:"仅有旧路径",topic_paths:["旧 / 路径"]});await env.DB.prepare("INSERT INTO entries(owner,id,version,data) VALUES(?,?,?,?)").bind("legacy-owner",old.id,old.version,JSON.stringify(old)).run();const legacyRepo=new D1Repository("legacy-owner");assert.equal((await legacyRepo.topics()).topics.length,2);assert.equal((await legacyRepo.topics()).topics.length,2);
    directory=await source.topics();await source.commit([],"human",[],{revision:directory.revision,topics:mergeTopicPaths(directory.topics,["独立空目录 / 空子目录"])});const restored=new D1Repository("v2-restored"),v2=await makeBackup(source);await importBackup(restored,v2,{},false).catch(e=>{if(!String(e).includes("缺失附件"))throw e;});const packed2=parseBackup(await zipBackup(source,v2),true);await importBackup(restored,packed2.backup,packed2.files,false);assert.ok([...topicPaths((await restored.topics()).topics).values()].includes("独立空目录 / 空子目录"));
    const service=new KnowledgeService(source),organization=new OrganizationService(source);
    const original=await service.create({title:"组织事务验收",content:"这是来源文本，讨论记忆。"});directory=await source.topics();
    await assert.rejects(()=>service.create({title:"不应新建",content:"AI 内容",topic_paths:["未批准的新主题"]},"ai"),/不能直接创建主题/);
    const theme=directory.topics[0];const input={entry_id:original.id,entry_version:original.version,directory_revision:directory.revision,items:[{action:"classify",topic_id:theme.id,reason:"分类验收",evidence:[{entry_id:original.id,quote:"这是来源文本"}]}]};
    const proposal=await organization.propose(input);assert.equal((await source.topics()).revision,directory.revision);assert.equal((await organization.propose(input)).id,proposal.id);
    await assert.rejects(()=>new OrganizationService(target).propose(input),/记录不存在/);
    const decisions=await Promise.allSettled([1,2].map(()=>organization.review(proposal.id,proposal.organization_proposal!.items[0].id,true,proposal.version)));
    assert.equal(decisions.filter(r=>r.status==="fulfilled").length,1);const classified=await source.get(original.id);assert.equal(classified.content,original.content);assert.equal(classified.status,"inbox");assert.deepEqual(classified.topic_ids,[theme.id]);assert.equal((await source.get(proposal.id)).status,"archived");
  }finally{await mf.dispose();}
});

