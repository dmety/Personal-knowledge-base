import { AppError, blankEntry, entrySchema, topicPathSchema, type Entry } from "./model";
import type { Repository } from "./repository";
import { topicPaths, topicIdsForPaths } from "./topics";

export class KnowledgeService {
  constructor(public repo:Repository){}
  async validateNetwork(entry:Entry,originalId=entry.id){
    const unique=new Set<string>();
    for(const r of entry.relations){if(r.target_id===originalId)throw new AppError("知识不能关联自己");const key=r.kind+":"+r.target_id;if(unique.has(key))throw new AppError("存在重复关系");unique.add(key);await this.repo.get(r.target_id);}
  }
  async create(input:Partial<Entry>,actor:"human"|"ai"="human"){
    if(actor==="ai")input=await this.aiTopics(input);
    const e=blankEntry({...input,id:crypto.randomUUID(),version:1,created_by:actor,status:actor==="ai"?"draft":"inbox",attachments:[],revision_of:null,base_version:null,organization_proposal:null,related_recommendations:[]},actor);
    await this.validateNetwork(e);
    await this.repo.commit([{before:null,after:e,action:"创建记录"}],actor);return this.repo.get(e.id);
  }
  async update(id:string,input:Partial<Entry>){
    const before=await this.repo.get(id);if(input.version!==before.version)throw new AppError("记录已变化，请刷新后重新编辑",409);
    if(before.organization_proposal)throw new AppError("组织建议请逐项审核，不能作为正文编辑");
    input={...input,short_id:before.short_id,original_content:before.original_content,capture_fingerprint:before.capture_fingerprint,organization_proposal:before.organization_proposal,related_recommendations:before.related_recommendations};
    const after=entrySchema.parse({...before,...input,id:before.id,created_at:before.created_at,created_by:before.created_by,revision_of:before.revision_of,base_version:before.base_version,attachments:before.attachments,version:before.version+1,updated_at:new Date().toISOString()});
    if(before.status==="draft" && after.status==="reviewed")throw new AppError("请使用审核按钮确认草稿");
    await this.validateNetwork(after,before.revision_of||before.id);
    await this.repo.commit([{before,after,action:"本人编辑"}],"human");return after;
  }
  async propose(id:string,proposed_content:string,reason:string,sources:Entry["sources"]=[],network:Partial<Pick<Entry,"topic_paths"|"relations">>={}){
    const base=await this.repo.get(id);if(base.organization_proposal)throw new AppError("请选择原始知识记录");network=Object.fromEntries(Object.entries(network).filter(([,v])=>v!==undefined));network=await this.aiTopics(network);const draft=blankEntry({...base,...network,id:crypto.randomUUID(),content:proposed_content,status:"draft",revision_of:base.id,base_version:base.version,reason,sources,created_by:"ai",version:1,attachments:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()},"ai");
    await this.validateNetwork(draft,base.id);
    await this.repo.commit([{before:null,after:draft,action:"AI 提交修改建议"}],"ai");return this.repo.get(draft.id);
  }
  async review(id:string,accept:boolean,version:number){
    const draft=await this.repo.get(id);if(draft.status!=="draft")throw new AppError("该记录不是待审核草稿");if(draft.version!==version)throw new AppError("草稿已变化，请重新核对",409);
    if(draft.organization_proposal)throw new AppError("组织建议必须逐项审核");
    const now=new Date().toISOString();
    if(accept&&draft.revision_of){
      const base=await this.repo.get(draft.revision_of);if(base.version!==draft.base_version)throw new AppError("原记录已更新，此建议基于旧版本。请重新提交建议后审核。",409);
      const updated:Entry={...base,content:draft.content,summary:draft.summary,tags:draft.tags,sources:draft.sources,source_url:draft.source_url,evidence:draft.evidence,topic_paths:draft.topic_paths,relations:draft.relations,status:"reviewed",version:base.version+1,updated_at:now};
      await this.validateNetwork(updated);
      await this.repo.commit([{before:base,after:updated,action:"接受 AI 修改建议"},{before:draft,after:{...draft,status:"archived",updated_at:now,version:draft.version+1},action:"建议已接受"}],"human");return updated;
    }
    const after:Entry={...draft,status:accept?"reviewed":"archived",updated_at:now,version:draft.version+1};
    await this.repo.commit([{before:draft,after,action:accept?"审核通过":"拒绝草稿"}],"human");return after;
  }
  async aiTopics(input:Partial<Entry>):Promise<Partial<Entry>>{
    const directory=await this.repo.topics(),paths=topicPaths(directory.topics);
    if(input.topic_ids?.some(id=>!paths.has(id)))throw new AppError("主题 ID 不存在，请先读取主题目录");
    const selected=input.topic_ids?.length?input.topic_ids.map(id=>paths.get(id)!):input.topic_paths?.map(p=>topicPathSchema.parse(p));
    if(selected?.some(p=>![...paths.values()].includes(p)))throw new AppError("AI 不能直接创建主题，请先读取目录并提交新主题组织建议");
    return selected?{...input,topic_paths:selected,topic_ids:topicIdsForPaths(selected,directory.topics)}:input;
  }
}
