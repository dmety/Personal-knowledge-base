import { env } from "cloudflare:workers";
import {personalProfileSchema,type PersonalProfile} from "./personal-profile";
import { AppError, entrySchema, historySchema, type Entry, type History, type Attachment } from "./model";
import { mergeTopicPaths, topicPaths, topicIdsForPaths, topicSchema, type Directory } from "./topics";

export interface Repository {
  list():Promise<Entry[]>; get(id:string):Promise<Entry>; histories(id?:string):Promise<History[]>;
  readTopics():Promise<Directory>; topics():Promise<Directory>;
  commit(changes:{before:Entry|null;after:Entry;action:string}[],actor:"human"|"ai",extraHistory?:History[],directory?:Directory,profileChange?:{before:PersonalProfile|null;after:PersonalProfile}):Promise<void>;
  readProfile?():Promise<PersonalProfile|null>;
  readAsset(id:string):Promise<R2ObjectBody|null>; putAsset(id:string,bytes:Uint8Array,mime:string):Promise<void>;
  lastExport():Promise<string|null>; markExport():Promise<void>;
}
export class D1Repository implements Repository {
  constructor(private owner:string){}
  private get db(){if(!env.DB)throw new AppError("数据库尚未配置",503);return env.DB;}
  private key(id:string){return `${this.owner}/${id}`;}
  async readProfile(){const r=await this.db.prepare("SELECT data FROM personal_profiles WHERE owner=?").bind(this.owner).first<{data:string}>();return r?personalProfileSchema.parse(JSON.parse(r.data)):null;}
  async writeProfile(input:PersonalProfile){const before=await this.readProfile();if(input.version!==(before?.version||0))throw new AppError("个人背景已在其他页面更新，请刷新后核对",409);const after=personalProfileSchema.parse({...input,version:input.version+1,updated_at:new Date().toISOString()});await this.commit([],"human",[],undefined,{before,after});return after;}
  private async references(entries:Entry[]) {
    const current=await this.db.prepare("SELECT entry_id,number FROM record_references WHERE owner=?").bind(this.owner).all<{entry_id:string;number:number}>();
    const numbers=new Map(current.results.map(r=>[r.entry_id,r.number]));
    for(const e of entries) if(!numbers.has(e.id)) {
      const preferred=e.short_id?Number(e.short_id.slice(2)):0;
      if(preferred>0)await this.db.prepare("INSERT OR IGNORE INTO record_references(owner,entry_id,number) VALUES(?,?,?)").bind(this.owner,e.id,preferred).run();
      await this.db.prepare("INSERT OR IGNORE INTO record_references(owner,entry_id,number) SELECT ?,?,COALESCE(MAX(number),0)+1 FROM record_references WHERE owner=?").bind(this.owner,e.id,this.owner).run();
      const row=await this.db.prepare("SELECT number FROM record_references WHERE owner=? AND entry_id=?").bind(this.owner,e.id).first<{number:number}>();numbers.set(e.id,row!.number);
    }
    for(const e of entries)e.short_id=`K-${String(numbers.get(e.id)).padStart(5,"0")}`;
    return entries;
  }
  async list(){const r=await this.db.prepare("SELECT data FROM entries WHERE owner=?").bind(this.owner).all<{data:string}>();const directory=await this.readTopics(),byPath=new Map([...topicPaths(directory.topics)].map(([id,p])=>[p,id]));return this.references(r.results.map(r=>{const e=entrySchema.parse(JSON.parse(r.data));return {...e,topic_ids:e.topic_paths.flatMap(p=>byPath.has(p)?[byPath.get(p)!]:[])};}));}
  async get(id:string){
    if(/^K-\d+$/i.test(id)){
      const ref=await this.db.prepare("SELECT entry_id FROM record_references WHERE owner=? AND number=?").bind(this.owner,Number(id.slice(2))).first<{entry_id:string}>();
      if(!ref)throw new AppError("记录不存在",404);id=ref.entry_id;
    }
    const r=await this.db.prepare("SELECT data FROM entries WHERE owner=? AND id=?").bind(this.owner,id).first<{data:string}>();if(!r)throw new AppError("记录不存在",404);const e=entrySchema.parse(JSON.parse(r.data));return (await this.references([{...e,topic_ids:topicIdsForPaths(e.topic_paths,(await this.readTopics()).topics)}]))[0];}
  async histories(id?:string){const sql=id?"SELECT data FROM history WHERE owner=? AND entry_id=?":"SELECT data FROM history WHERE owner=?";const r=await this.db.prepare(sql).bind(...(id?[this.owner,id]:[this.owner])).all<{data:string}>();return r.results.map(r=>historySchema.parse(JSON.parse(r.data))).sort((a,b)=>b.at.localeCompare(a.at));}
  async readTopics():Promise<Directory>{const r=await this.db.prepare("SELECT revision,data FROM topic_directories WHERE owner=?").bind(this.owner).first<{revision:number;data:string}>();return r?{revision:r.revision,topics:JSON.parse(r.data).map((t:unknown)=>topicSchema.parse(t))}:{revision:0,topics:[]};}
  async topics():Promise<Directory>{
    for(let attempt=0;attempt<3;attempt++){
      const directory=await this.readTopics(),merged=mergeTopicPaths(directory.topics,(await this.list()).flatMap(e=>e.topic_paths));
      if(merged.length===directory.topics.length)return directory;
      try{await this.commit([],"human",[],{...directory,topics:merged});return await this.readTopics();}catch(e){if(!(e instanceof AppError)||e.status!==409||attempt===2)throw e;}
    }
    throw new AppError("主题目录已变化，请刷新",409);
  }
  async commit(changes:{before:Entry|null;after:Entry;action:string}[],actor:"human"|"ai",extraHistory:History[]=[],directory?:Directory,profileChange?:{before:PersonalProfile|null;after:PersonalProfile}){
    if(profileChange&&actor!=="human")throw new AppError("插件不能直接修改个人背景",403);
    const snapshot=directory??await this.readTopics();
    if(actor==="ai"){
      const known=new Set(topicPaths(snapshot.topics).values());
      if(changes.some(c=>c.after.topic_paths.some(p=>!known.has(p))))throw new AppError("AI 不能直接创建主题，请提交新主题组织建议");
    }
    const topics=mergeTopicPaths(snapshot.topics,changes.flatMap(c=>c.after.topic_paths));topicPaths(topics);
    const current=await this.readTopics(),directoryChanged=JSON.stringify(current.topics)!==JSON.stringify(topics);
    const nextRevision=snapshot.revision+(directoryChanged?1:0);
    await this.references(changes.map(c=>c.after));
    const commands:D1PreparedStatement[]=[];
    if(profileChange){const {before,after}=profileChange;personalProfileSchema.parse(after);commands.push(before?this.db.prepare("UPDATE personal_profiles SET version=?,data=? WHERE owner=? AND version=?").bind(after.version,JSON.stringify(after),this.owner,before.version):this.db.prepare("INSERT INTO personal_profiles(owner,version,data) VALUES(?,?,?)").bind(this.owner,after.version,JSON.stringify(after)));commands.push(this.db.prepare("INSERT INTO mutation_guard (valid) VALUES (changes())"));}
    if(snapshot.revision===0)commands.push(this.db.prepare("INSERT OR IGNORE INTO topic_directories(owner,revision,data) VALUES(?,?,?)").bind(this.owner,1,JSON.stringify(topics)));
    else commands.push(this.db.prepare("UPDATE topic_directories SET revision=?,data=? WHERE owner=? AND revision=?").bind(nextRevision,JSON.stringify(topics),this.owner,snapshot.revision));
    commands.push(this.db.prepare("INSERT INTO mutation_guard (valid) VALUES (changes())"));
    // A CHECK guard makes stale edits abort the entire D1 transaction, including history.
    for(const {before,after,action} of changes){
      after.topic_ids=topicIdsForPaths(after.topic_paths,topics);
      const h:History={id:crypto.randomUUID(),entry_id:after.id,at:new Date().toISOString(),actor,action,before,after};
      if(before){commands.push(this.db.prepare("UPDATE entries SET version=?, data=? WHERE owner=? AND id=? AND version=?").bind(after.version,JSON.stringify(after),this.owner,after.id,before.version));
        commands.push(this.db.prepare("INSERT INTO mutation_guard (valid) VALUES (changes())"));}
      else commands.push(this.db.prepare("INSERT INTO entries(owner,id,version,data) VALUES(?,?,?,?)").bind(this.owner,after.id,after.version,JSON.stringify(after)));
      commands.push(this.db.prepare("INSERT INTO history(owner,id,entry_id,data) VALUES(?,?,?,?)").bind(this.owner,h.id,h.entry_id,JSON.stringify(h)));
    }
    for(const h of extraHistory)commands.push(this.db.prepare("INSERT OR IGNORE INTO history(owner,id,entry_id,data) VALUES(?,?,?,?)").bind(this.owner,h.id,h.entry_id,JSON.stringify(h)));
    commands.push(this.db.prepare("DELETE FROM mutation_guard"));
    try{await this.db.batch(commands);}catch(e){if(String(e).includes("CHECK")||String(e).includes("UNIQUE"))throw new AppError("记录已变化或 ID 冲突，请刷新后重新确认",409);throw e;}
  }
  async readAsset(id:string){if(!env.BUCKET)throw new AppError("附件存储尚未配置",503);return env.BUCKET.get(this.key(id));}
  async putAsset(id:string,bytes:Uint8Array,mime:string){if(!env.BUCKET)throw new AppError("附件存储尚未配置",503);await env.BUCKET.put(this.key(id),bytes,{httpMetadata:{contentType:mime}});}
  async lastExport(){const r=await this.db.prepare("SELECT last_export FROM settings WHERE owner=?").bind(this.owner).first<{last_export:string}>();return r?.last_export||null;}
  async markExport(){await this.db.prepare("INSERT INTO settings(owner,last_export) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET last_export=excluded.last_export").bind(this.owner,new Date().toISOString()).run();}
}
export const assetMeta=(entry:Entry,id:string):Attachment=>{const a=entry.attachments.find(a=>a.id===id);if(!a)throw new AppError("附件不存在",404);return a;};

