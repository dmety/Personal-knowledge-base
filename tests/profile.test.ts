import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Miniflare} from "miniflare";
import {env} from "./worker-env";
import {defaultPersonalProfile,moveProfileField,personalProfileSchema} from "../lib/personal-profile";
import {D1Repository} from "../lib/repository";
import {makeBackup,importBackup,parseBackup,zipBackup} from "../lib/backup";
import {blankEntry} from "../lib/model";

test("custom fields move with values, repeated histories never truncate, duplicate fields rejected",()=>{
  const p=defaultPersonalProfile();assert.equal(p.groups.length,5);
  p.groups[0].fields[0].value="测试称呼";const moved=moveProfileField(p,"personal","personal-0","education");assert.equal(moved.groups[1].rows[0].values["personal-0"],"测试称呼");assert.equal(moved.groups[0].fields.length,4);assert.equal(p.groups[0].fields.length,5);
  const restored=moveProfileField(moved,"education","personal-0","personal");assert.equal(restored.groups[0].fields.at(-1)?.value,"测试称呼");
  p.groups[1].rows=[{id:"first",values:{"education-0":"学校甲"}},{id:"second",values:{"education-0":"学校乙"}}];assert.throws(()=>moveProfileField(p,"education","education-0","personal"),/多段/);
  const duplicate=structuredClone(p);duplicate.groups[0].fields.push(duplicate.groups[0].fields[0]);assert.equal(personalProfileSchema.safeParse(duplicate).success,false);
  const wrong=structuredClone(p);wrong.groups[0].fields[1].value="数字外的内容";assert.equal(personalProfileSchema.safeParse(wrong).success,false);
});

test("profile ownership, CAS conflicts and atomic v4 backup restore without a plugin toggle",async()=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:"2026-05-15",d1Databases:["DB"],r2Buckets:["BUCKET"],cf:false});
  try{
    env.DB=await mf.getD1Database("DB") as unknown as D1Database;env.BUCKET=await mf.getR2Bucket("BUCKET") as unknown as R2Bucket;
    for(const file of ["0000_sleepy_logan.sql","0001_fancy_hellcat.sql","0002_capture_references.sql","0003_personal_profiles.sql"]){for(const statement of (await readFile("drizzle/"+file,"utf8")).split("--> statement-breakpoint").filter(s=>s.trim()))await env.DB.prepare(statement).run();}
    const source=new D1Repository("profile-source"),other=new D1Repository("other-owner"),target=new D1Repository("profile-restored");
    assert.equal(await source.readProfile(),null);const p=defaultPersonalProfile();p.groups[0].fields[0].value="虚构验收用户";
    const saved=await source.writeProfile(p);assert.equal(saved.version,1);assert.equal(await other.readProfile(),null);assert.equal((await source.list()).length,0);
    const concurrent=await Promise.allSettled([1,2].map(i=>source.writeProfile({...saved,groups:[...saved.groups,{id:`custom-${i}`,name:`自定义 ${i}`,fields:[],rows:[],repeatable:false}]})));assert.equal(concurrent.filter(v=>v.status==="fulfilled").length,1);
    const current=(await source.readProfile())!;assert.equal(current.version,2);
    const entry=blankEntry({title:"测试原记录",content:"正文"});await source.commit([{before:null,after:entry,action:"创建"}],"human");
    const backup=await makeBackup(source);assert.equal(backup.schema_version,4);assert.equal(backup.personal_profile?.groups.length,6);
    const parsed=parseBackup(await zipBackup(source,backup),true);await importBackup(target,parsed.backup,parsed.files,false);assert.deepEqual((await target.readProfile())!.groups,current.groups);assert.equal("share_with_plugin" in (await target.readProfile())!,false);
    await importBackup(target,{...backup,personal_profile:{...current,groups:[]}}, {},false);assert.equal((await target.readProfile())!.groups.length,6);
    await importBackup(target,{...backup,personal_profile:{...current,groups:[]}}, {},true);assert.equal((await target.readProfile())!.groups.length,0);
    await assert.rejects(()=>source.commit([],"ai",[],undefined,{before:current,after:{...current,groups:[]}}),/不能直接修改/);
    const before=await target.readProfile();await assert.rejects(async()=>target.commit([{before:await target.get(entry.id),after:{...entry,version:3},action:"错误版本"}],"human",[],undefined,{before:{...before!,version:0},after:{...before!,version:99,groups:[]}}),/已变化/);assert.equal((await target.readProfile())!.version,before!.version);
  }finally{await mf.dispose();}
});
