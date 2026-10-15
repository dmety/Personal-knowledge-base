import {z} from "zod";
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const profileFieldTypes=["text","longtext","number","date"] as const;
export const profileFieldLabels={text:"短文本",longtext:"长文本",number:"数字",date:"日期"};
export const profileValueValid=(value:string,type:string)=>!value||(type==="number"?value.trim()!==""&&Number.isFinite(Number(value)):type==="date"?/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value:true);
const fieldSchema=z.object({id,name:z.string().trim().min(1,"字段名称不能为空").max(80,"字段名称最多 80 字"),type:z.enum(profileFieldTypes),value:z.string().max(10000).default("")});
const groupSchema=z.object({id,name:z.string().trim().min(1,"组别名称不能为空").max(80,"组别名称最多 80 字"),repeatable:z.boolean().default(false),fields:z.array(fieldSchema).max(40),rows:z.array(z.object({id,values:z.record(z.string().max(10000))})).max(50).default([])});
export const personalProfileSchema=z.object({groups:z.array(groupSchema).max(30),version:z.number().int().nonnegative().default(0),updated_at:z.string().datetime().nullable().default(null)}).superRefine((p,ctx)=>{
  if(JSON.stringify(p).length>300000)ctx.addIssue({code:"custom",message:"背景内容过长，请精简到 30 万字符以内"});
  const ids=new Set<string>();
  const valueValid=profileValueValid;
  for(const g of p.groups){
    if(ids.has(g.id))ctx.addIssue({code:"custom",message:"组别编号重复"});ids.add(g.id);
    const fields=new Set(g.fields.map(f=>f.id));
    for(const f of g.fields){if(ids.has(f.id))ctx.addIssue({code:"custom",message:"字段编号重复"});ids.add(f.id);if(!g.repeatable&&!valueValid(f.value,f.type))ctx.addIssue({code:"custom",message:`${f.name}的值与填写方式不符`});}
    const rows=new Set<string>();for(const row of g.rows){if(rows.has(row.id))ctx.addIssue({code:"custom",message:"经历编号重复"});rows.add(row.id);for(const key of Object.keys(row.values))if(!fields.has(key))ctx.addIssue({code:"custom",message:"经历引用了不存在的字段"});for(const f of g.fields)if(!valueValid(row.values[f.id]||"",f.type))ctx.addIssue({code:"custom",message:`${f.name}的值与填写方式不符`});}
  }
});
export type PersonalProfile=z.infer<typeof personalProfileSchema>;
export type ProfileGroup=PersonalProfile["groups"][number];
export type ProfileField=ProfileGroup["fields"][number];
export function defaultPersonalProfile():PersonalProfile{
  const group=(key:string,name:string,names:string[],repeatable=false):ProfileGroup=>({id:key,name,repeatable,fields:names.map((name,i)=>({id:`${key}-${i}`,name,type:name==="年龄"?"number":/主要工作|事情|技能|项目经历|成果|正在学习/.test(name)?"longtext":"text",value:""})),rows:repeatable?[{id:`${key}-row`,values:{}}]:[]});
  return {groups:[group("personal","个人信息",["姓名／称呼","年龄","专业","职业／身份","当前学习或工作阶段"]),group("education","教育背景",["学校","学历","所学专业","就读时间"],true),group("work","工作背景",["公司／单位","岗位","任职时间","主要工作内容"],true),group("goals","当前目标",["正在学习什么","求职方向","近期想完成的事情"]),group("ability","个人能力",["掌握的技能","项目经历","其他能力与成果"])],version:0,updated_at:null};
}

// Move values as well as the field. Incompatible multi-row moves are rejected, never truncated.
export function moveProfileField(profile:PersonalProfile,sourceId:string,fieldId:string,targetId:string):PersonalProfile{
  const next=structuredClone(profile),source=next.groups.find(g=>g.id===sourceId),target=next.groups.find(g=>g.id===targetId),field=source?.fields.find(f=>f.id===fieldId);
  if(!source||!target||!field||source===target)throw new Error("请选择另一个组别");
  const values=source.repeatable?source.rows.map(r=>r.values[fieldId]||""):[field.value];
  if(!target.repeatable&&values.filter(Boolean).length>1)throw new Error("该字段有多段经历内容，请先合并内容，或移到支持多段的组别");
  source.fields=source.fields.filter(f=>f.id!==fieldId);source.rows.forEach(r=>delete r.values[fieldId]);
  if(target.repeatable){while(target.rows.length<Math.max(1,values.length))target.rows.push({id:crypto.randomUUID(),values:{}});values.forEach((v,i)=>{target.rows[i].values[fieldId]=v;});field.value="";}
  else field.value=values.find(Boolean)||"";
  target.fields.push(field);return personalProfileSchema.parse(next);
}
