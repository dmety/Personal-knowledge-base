import { z } from "zod";
import {personalProfileSchema} from "./personal-profile";

export const kinds = ["source", "idea", "project", "reference"] as const;
export const statuses = ["inbox", "draft", "reviewed", "archived"] as const;
export const kindLabels = {source: "资料", idea: "想法", project: "项目", reference: "参考"};
export const statusLabels = {inbox: "收集箱", draft: "待审核", reviewed: "已整理", archived: "已归档"};
export const allowedMime = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const url = z.string().max(4000).refine(v => !v || /^https?:\/\//i.test(v) && (() => {try {return !!new URL(v).hostname;} catch {return false;}})(), "来源必须为 http 或 https 网址");
export const attachmentSchema = z.object({id, name:z.string().min(1).max(200), mime:z.enum(["image/jpeg","image/png","image/webp","application/pdf"]), size:z.number().int().positive().max(20*1024*1024), path:z.string().regex(/^assets\/[a-zA-Z0-9_-]+$/)});
export const relationKinds = ["supplement", "depends_on", "contrast", "example"] as const;
export const relationLabels = {supplement:"补充说明",depends_on:"依赖",contrast:"对比",example:"应用案例"};
export const quoteSchema = z.object({entry_id:id,field:z.enum(["content","summary","evidence","notes"]).default("content"),quote:z.string().trim().min(1).max(2000)});
export const organizationItemSchema = z.object({
  id, action:z.enum(["classify","alias","new_topic","topic_related","record_relation"]),
  reason:z.string().trim().min(1).max(2000), topic_id:id.optional(), target_id:id.optional(),
  name:z.string().trim().min(1).max(80).optional(), parent_id:id.nullable().optional(),
  definition:z.string().max(2000).optional(), scope:z.string().max(2000).optional(),
  kind:z.enum(relationKinds).optional(), strength:z.enum(["strong","weak"]).default("weak"),
  basis:z.enum(["explicit","inference"]).default("inference"),
  evidence:z.array(quoteSchema).max(10).default([]),
  decision:z.enum(["pending","accepted","rejected"]).default("pending"), feedback:z.string().max(2000).default(""),
});
export const organizationProposalSchema = z.object({
  directory_revision:z.number().int().nonnegative(), items:z.array(organizationItemSchema).min(1).max(30),
  evidence_versions:z.record(z.number().int().positive()).default({}),
  topic_context:z.record(z.object({name:z.string(),parent_id:id.nullable(),definition:z.string(),scope:z.string()})).optional(),
});
export type OrganizationItem = z.infer<typeof organizationItemSchema>;
export type OrganizationProposal = z.infer<typeof organizationProposalSchema>;
export const topicLinkSchema=z.object({target_id:id,note:z.string().min(1).max(2000),strength:z.enum(["strong","weak"]),basis:z.enum(["explicit","inference"]),evidence:z.array(quoteSchema).max(10).default([])});
export const topicPathSchema = z.string().max(400).transform(v=>v.split("/").map(s=>s.trim()).join(" / ")).refine(v=>{const parts=v.split(" / ");return parts.length<=5 && parts.every(p=>p.length>0&&p.length<=80);},"主题路径最多五层，每层不能为空");
export const relationSchema = z.object({target_id:id,kind:z.enum(relationKinds),note:z.string().max(2000).default("")});
export const entrySchema = z.object({
  short_id:z.string().regex(/^K-[0-9]{5,}$/).optional(),
  original_content:z.string().max(500000).default(""),
  capture_fingerprint:z.string().max(64).optional(),
  id, title:z.string().max(500), summary:z.string().max(2000).default(""), content:z.string().max(500000),
  kind:z.enum(kinds), status:z.enum(statuses), source_url:url.default(""), source_title:z.string().max(500).default(""),
  evidence:z.string().max(100000).default(""), notes:z.string().max(100000).default(""),
  topic_paths:z.array(topicPathSchema).max(20).default([]), topic_ids:z.array(id).max(20).default([]), relations:z.array(relationSchema).max(100).default([]),
  organization_proposal:organizationProposalSchema.nullable().default(null),
  related_recommendations:z.array(organizationItemSchema).max(100).default([]),
  tags:z.array(z.string().min(1).max(80)).max(50), related_ids:z.array(id).max(100),
  created_at:z.string().datetime(), updated_at:z.string().datetime(), created_by:z.enum(["human","ai"]),
  revision_of:id.nullable().default(null), base_version:z.number().int().positive().nullable().default(null),
  reason:z.string().max(10000).default(""), sources:z.array(z.object({title:z.string().max(500),url:url,entry_id:id.optional()})).max(100).default([]),
  attachments:z.array(attachmentSchema).max(10).default([]), version:z.number().int().positive(),
}).refine(e => !!e.title.trim() || !!e.content.trim(), "标题和正文至少填写一项");
export type Entry = z.infer<typeof entrySchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type History = {id:string; entry_id:string; at:string; actor:"human"|"ai"; action:string; before:Entry|null; after:Entry|null};
export const historySchema = z.object({id,entry_id:id,at:z.string().datetime(),actor:z.enum(["human","ai"]),action:z.string().max(100),before:entrySchema.nullable(),after:entrySchema.nullable()});
export const topicSchema = z.object({id,parent_id:id.nullable(),name:z.string().trim().min(1).max(80).refine(s=>!s.includes("/"),"主题名称不能包含 /"),position:z.number().int().nonnegative(),version:z.number().int().positive(),definition:z.string().max(2000).default(""),scope:z.string().max(2000).default(""),aliases:z.array(z.string().trim().min(1).max(80)).max(50).default([]),representative_ids:z.array(id).max(10).default([]),links:z.array(topicLinkSchema).max(100).default([])});
export const backupSchema = z.object({format:z.literal("zhixu-backup"),schema_version:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),exported_at:z.string().datetime(),entries:z.array(entrySchema).max(10000),history:z.array(historySchema).max(50000),topics:z.array(topicSchema).max(10000).default([]),personal_profile:personalProfileSchema.nullable().optional()});
export type Backup = z.infer<typeof backupSchema>;
export class AppError extends Error {constructor(message:string,public status=400){super(message);}}
export function blankEntry(input:Partial<Entry>,actor:"human"|"ai"="human"):Entry {
  const now=new Date().toISOString();
  return entrySchema.parse({id:input.id??crypto.randomUUID(),title:"",summary:"",content:"",kind:"source",status:actor==="ai"?"draft":"inbox",source_url:"",source_title:"",evidence:"",notes:"",topic_paths:[],relations:[],tags:[],related_ids:[],created_at:now,updated_at:now,created_by:actor,revision_of:null,base_version:null,reason:"",sources:[],attachments:[],version:1,...input});
}
export function searchEntries(entries:Entry[],query="",filters:Record<string,string>={},limit=100):Array<Entry & {relevance:number;snippet:string}> {
  const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(e => filters.status ? e.status===filters.status : e.status!=="archived")
    .filter(e=>!e.organization_proposal&&!e.revision_of||filters.status==="draft"||filters.status==="archived")
    .filter(e=>filters.unclassified!=="true" || !e.organization_proposal&&!e.revision_of&&!e.topic_paths.length)
    .filter(e=>!filters.topic || e.topic_paths.some(p=>p===filters.topic||p.startsWith(filters.topic+" / ")))
    .filter(e=>!filters.kind || e.kind===filters.kind).filter(e=>!filters.tag || e.tags.includes(filters.tag))
    .map(e=>{const title=e.title.toLocaleLowerCase(),tags=[...e.tags,...e.topic_paths].join(" ").toLocaleLowerCase(),body=(e.summary+" "+e.content).toLocaleLowerCase();
      const matches=words.every(w=>title.includes(w)||tags.includes(w)||body.includes(w)||(e.short_id||"").toLowerCase()===w);
      const relevance=matches ? words.reduce((s,w)=>s+(title.includes(w)?10:0)+(tags.includes(w)?6:0)+(body.includes(w)?2:0),0): -1;
      const pos=words.length?e.content.toLocaleLowerCase().indexOf(words[0]):-1;
      return {...e,relevance,snippet:pos>=0?e.content.slice(Math.max(0,pos-35),pos+160):(e.summary||e.content).slice(0,180)};})
    .filter(e=>e.relevance>=0).sort((a,b)=>(filters.prefer_reviewed==="true"?Number(b.status==="reviewed")-Number(a.status==="reviewed"):0)||b.relevance-a.relevance||b.updated_at.localeCompare(a.updated_at)).slice(0,limit);
}
export function magicMime(bytes:Uint8Array):string {
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return "image/jpeg";
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return "image/png";
  const s=new TextDecoder().decode(bytes.slice(0,12));
  if(s.startsWith("%PDF-"))return "application/pdf";
  if(s.startsWith("RIFF")&&s.slice(8)==="WEBP")return "image/webp";
  return "";
}
