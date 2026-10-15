import { authorizedRepository, errorResponse } from "@/lib/auth";
import { KnowledgeService } from "@/lib/service";
import { AppError, allowedMime, magicMime, searchEntries } from "@/lib/model";
import { assetMeta } from "@/lib/repository";
import { makeBackup, zipBackup, parseBackup, previewImport, importBackup } from "@/lib/backup";
import { makeDemoEntries } from "@/examples/demo-content/entries";
import { z } from "zod";
import { entrySchema } from "@/lib/model";
import { captureRecord, captureLimit } from "@/lib/capture";
import { resolveRecordArguments } from "@/lib/plugin-images";
import { OrganizationService } from "@/lib/organization";
import { knowledgeRecords } from "@/lib/topics";
import { fileOperationSchema, organizeRecord } from "@/lib/file-organization";
export const dynamic="force-dynamic";
const json=(data:unknown)=>Response.json(data,{headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){try{
  const repo=await authorizedRepository(request);const p=new URL(request.url).searchParams;
  if(p.get("network"))return json({entries:await repo.list()});
  if(p.get("asset")){const entry=await repo.get(p.get("id")||"");const a=assetMeta(entry,p.get("asset")!);const asset=await repo.readAsset(a.id);if(!asset)throw new AppError("附件文件不存在",404);return new Response(asset.body,{headers:{"Content-Type":a.mime,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}
  if(p.get("id")){const entry=await repo.get(p.get("id")!);const base=entry.revision_of?await repo.get(entry.revision_of).catch(()=>null):null;const target=base||entry;const organizations=await Promise.all((await repo.list()).filter(e=>e.organization_proposal&&e.revision_of===target.id&&e.status==="draft").map(async e=>({entry:e,base:target,errors:await new OrganizationService(repo).assess(e)})));
    return json({entry,history:await repo.histories(entry.id),base,organizations,organization_errors:entry.organization_proposal?await new OrganizationService(repo).assess(entry):{}});}
  if(p.get("export")){const backup=await makeBackup(repo);const zip=p.get("export")==="zip";const bytes=zip?await zipBackup(repo,backup):new TextEncoder().encode(JSON.stringify(backup,null,2));await repo.markExport();return new Response(bytes,{headers:{"Content-Type":zip?"application/zip":"application/json","Content-Disposition":`attachment; filename="zhixu-${new Date().toISOString().slice(0,10)}.${zip?"zip":"json"}"`,"Cache-Control":"no-store"}});}
  const entries=await repo.list();return json({entries:searchEntries(entries,p.get("q")||"",Object.fromEntries(p.entries()),10000),counts:Object.fromEntries(["inbox","draft","reviewed","archived"].map(s=>[s,entries.filter(e=>e.status===s&&(s==="draft"||!e.organization_proposal&&!e.revision_of)).length])),tags:[...new Set(knowledgeRecords(entries).flatMap(e=>e.tags))].sort(),total:knowledgeRecords(entries).length,last_export:await repo.lastExport()});
}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
  const repo=await authorizedRepository(request,true),service=new KnowledgeService(repo);
  if(request.headers.get("content-type")?.startsWith("multipart/form-data")){
    if(Number(request.headers.get("content-length"))>81*1024*1024)throw new AppError("上传超过 80 MB",413);
    const data=await request.formData();const action=String(data.get("action"));
    if(action==="capture"){
      const files=data.getAll("files");if(files.some(f=>!(f instanceof File)))throw new AppError("照片格式无效");
      if(files.reduce((n,f)=>n+(f as File).size,0)>captureLimit)throw new AppError("照片总量超过 40 MB",413);
      return json({entry:await captureRecord(repo,String(data.get("request_id")),String(data.get("content")||""),files as File[])});
    }
    const file=data.get("file");if(!(file instanceof File))throw new AppError("请选择文件");
    if(action==="upload"){
      if(file.size>20*1024*1024||!allowedMime.includes(file.type)||!file.size)throw new AppError("仅支持 20 MB 以内的 JPEG、PNG、WebP 和 PDF");
      const before=await repo.get(String(data.get("id")));if(before.organization_proposal)throw new AppError("请将附件上传到原始记录");if(before.attachments.length>=10)throw new AppError("每条记录最多 10 个附件");const bytes=new Uint8Array(await file.arrayBuffer());if(magicMime(bytes)!==file.type)throw new AppError("文件内容与类型不一致");
      const id=crypto.randomUUID();await repo.putAsset(id,bytes,file.type);const after={...before,version:before.version+1,updated_at:new Date().toISOString(),attachments:[...before.attachments,{id,name:file.name.slice(0,200),mime:file.type as "image/png",size:file.size,path:`assets/${id}`}]};
      await repo.commit([{before,after,action:"上传附件"}],"human");return json({entry:after});
    }
    if(file.size>80*1024*1024)throw new AppError("备份文件超过 80 MB",413);
    const {backup,files}=parseBackup(new Uint8Array(await file.arrayBuffer()),file.name.toLowerCase().endsWith(".zip"));
    if(action==="preview-import")return json(await previewImport(repo,backup,files));
    if(action==="import"){const replace=data.get("replace")==="true";if(replace&&data.get("confirmed")!=="true")throw new AppError("替换需要本人确认");return json(await importBackup(repo,backup,files,replace));}
    throw new AppError("不支持的操作");
  }
  const raw=await resolveRecordArguments(repo,await request.json()) as {action?:unknown}|null;
  if(raw?.action==="organize"){
    const input=fileOperationSchema.parse(raw),directory=await repo.topics(),before=await repo.get(input.id),change=organizeRecord(before,directory,input);
    await repo.commit([change],"human",[],directory);return json({entry:change.after});
  }
  const body=z.object({action:z.enum(["create","update","review","organization-review","demo"]),id:z.string().optional(),item_id:z.string().optional(),feedback:z.string().max(2000).default(""),entry:entrySchema.innerType().partial().optional(),accept:z.boolean().optional(),version:z.number().int().positive().optional()}).parse(raw);
  if(body.action==="organization-review")return json(await new OrganizationService(repo).review(z.string().parse(body.id),z.string().parse(body.item_id),body.accept===true,z.number().parse(body.version),body.feedback));
  if(body.action==="create")return json({entry:await service.create(body.entry||{})});
  if(body.action==="update")return json({entry:await service.update(z.string().parse(body.id),body.entry||{})});
  if(body.action==="review")return json({entry:await service.review(z.string().parse(body.id),body.accept===true,z.number().parse(body.version))});
  if(body.action==="demo"){const entries=makeDemoEntries();const b={format:"zhixu-backup" as const,schema_version:1 as const,exported_at:new Date().toISOString(),entries,history:[],topics:[]};return json(await importBackup(repo,b,{},false));}
  throw new AppError("不支持的操作");
}catch(e){return errorResponse(e);}}

