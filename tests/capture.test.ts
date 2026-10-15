import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Miniflare} from "miniflare";
import {env} from "./worker-env";
import {D1Repository} from "../lib/repository";
import {captureRecord} from "../lib/capture";
import {knowledgeImages,resolveRecordArguments} from "../lib/plugin-images";
import {blankEntry} from "../lib/model";
import {KnowledgeService} from "../lib/service";
import {makeBackup,importBackup} from "../lib/backup";

test("capture retry, concurrent numbering, private image content and original preservation",async()=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:"2026-05-15",d1Databases:["DB"],r2Buckets:["BUCKET"],cf:false});
  try{
    env.DB=await mf.getD1Database("DB") as unknown as D1Database;env.BUCKET=await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
    for(const file of ["0000_sleepy_logan.sql","0001_fancy_hellcat.sql","0002_capture_references.sql","0003_personal_profiles.sql"]){for(const statement of (await readFile("drizzle/"+file,"utf8")).split("--> statement-breakpoint").filter(s=>s.trim()))await env.DB.prepare(statement).run();}
    const repo=new D1Repository("capture-owner"),other=new D1Repository("another-owner");
    const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=","base64"));
    const photo=new File([png],"课堂.png",{type:"image/png"});const key=crypto.randomUUID();
    const records=await Promise.all([1,2].map(()=>captureRecord(repo,key,"",[photo])));
    assert.equal(records[0].id,records[1].id);assert.equal((await repo.list()).length,1);assert.equal(records[0].attachments.length,1);assert.match(records[0].short_id!,/^K-\d{5,}$/);
    const e=await repo.get(records[0].short_id!);assert.equal(e.id,records[0].id);await assert.rejects(()=>other.get(e.short_id!),/记录不存在/);
    await assert.rejects(()=>captureRecord(repo,key,"改了内容",[photo]),/已保存|冲突/);
    await assert.rejects(()=>captureRecord(repo,crypto.randomUUID(),"",[]),/请写/);
    await assert.rejects(()=>captureRecord(repo,crypto.randomUUID(),"",[new File([png],"伪装.jpg",{type:"image/jpeg"})]),/格式|转换/);
    const images=await knowledgeImages(repo,e.short_id!);assert.equal(images[1].type,"image");if(images[1].type==="image")assert.deepEqual(Buffer.from(images[1].data,"base64"),Buffer.from(png));
    await assert.rejects(()=>knowledgeImages(other,e.id),/不存在/);
    const migrated=blankEntry({id:"legacy-id",title:"旧记录"});await env.DB.prepare("INSERT INTO entries(owner,id,version,data) VALUES(?,?,?,?)").bind("capture-owner",migrated.id,1,JSON.stringify(migrated)).run();
    const legacy=await repo.get(migrated.id);assert.ok(legacy.short_id);assert.equal((await repo.get(legacy.short_id!)).id,migrated.id);
    const created=await Promise.all(Array.from({length:5},(_,i)=>captureRecord(repo,crypto.randomUUID(),`原话 ${i}`,[])));
    assert.equal(new Set(created.map(e=>e.short_id)).size,5);
    const normalized=await resolveRecordArguments(repo,{id:e.short_id,related_ids:[legacy.short_id],items:[{evidence:[{entry_id:legacy.short_id}]}]}) as {id:string;related_ids:string[]};assert.equal(normalized.id,e.id);assert.equal(normalized.related_ids[0],legacy.id);
    const service=new KnowledgeService(repo),draft=await service.create({title:"整理结果",content:"AI 整理正文",original_content:"用户原话"},"ai");
    assert.equal(draft.status,"draft");await service.update(draft.id,{version:draft.version,original_content:"不应覆盖"});assert.equal((await repo.get(draft.id)).original_content,"用户原话");
    const backup=await makeBackup(repo);const empty=new D1Repository("empty-restore");const files=Object.fromEntries([[e.attachments[0].path,png]]);await importBackup(empty,backup,files,false);assert.equal((await empty.get(draft.short_id!)).original_content,"用户原话");assert.equal((await empty.get(legacy.short_id!)).id,legacy.id);
  }finally{await mf.dispose();}
});
