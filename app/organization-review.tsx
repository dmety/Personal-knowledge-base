"use client";
import { useEffect, useState } from "react";
import { relationLabels, type Entry } from "@/lib/model";
import { organizationLabels } from "@/lib/organization";
import { loadTopics } from "./topic-sidebar";
import type { TopicItem } from "@/lib/topics";

export default function OrganizationReview({entry,base,errors,busy,onReview}:{entry:Entry;base:Entry|null;errors?:Record<string,string>;busy:boolean;onReview:(itemId:string,accept:boolean,feedback:string)=>Promise<void>}){
  const [topics,setTopics]=useState<TopicItem[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[feedback,setFeedback]=useState<Record<string,string>>({});
  useEffect(()=>{let active=true;setLoading(true);void loadTopics().then(d=>{if(active){setTopics(d.topics);setError("");}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[entry.id,entry.version]);
  const proposal=entry.organization_proposal!;
  const topicName=(id?:string)=>topics.find(t=>t.id===id)?.path||id||"未指定";
  return <section className="organization-review" aria-label="分类与关系逐项审核">
    <h2>分类与关系建议</h2><p className="muted">逐项确认。接受分类不会修改正文，也不会改变原记录的内容审核状态。</p>
    {base&&<p>原分类：{base.topic_paths.join("；")||"未分类"} · 原状态：{base.status==="inbox"?"收集箱":base.status==="reviewed"?"已整理":base.status==="draft"?"草稿":"归档"}</p>}
    {error&&<p role="alert" className="danger">{error}</p>}{loading&&<p className="muted" role="status">正在读取主题目录…</p>}
    {proposal.items.map(item=><article className="organization-item" key={item.id}>
      <div className="section-line"><h3>{organizationLabels[item.action]}</h3><span className="badge">{item.decision==="pending"?"待确认":item.decision==="accepted"?"已接受":"已拒绝"}</span></div>
      {item.action==="classify"&&<p>加入：<strong>{topicName(item.topic_id)}</strong></p>}
      {item.action==="alias"&&<p>将“{item.name}”登记为“{topicName(item.topic_id)}”的别名。</p>}
      {item.action==="new_topic"&&<><p>新主题：<strong>{item.parent_id?topicName(item.parent_id)+" / ":""}{item.name}</strong></p><p>含义：{item.definition}</p>{item.scope&&<p>适用范围：{item.scope}</p>}</>}
      {item.action==="topic_related"&&<p>{topicName(item.topic_id)} ↔ {topicName(item.target_id)}</p>}
      {item.action==="record_relation"&&<p>{item.kind?relationLabels[item.kind]:"可能相关"} → <a href={`/?entry=${encodeURIComponent(item.target_id||"")}`}>查看目标记录</a>{item.strength==="weak"&&"（仅保留为推荐，不建立正式连线）"}</p>}
      {["topic_related","record_relation"].includes(item.action)&&<p className="small">{item.strength==="strong"?"强关联候选":"弱关联候选"} · {item.basis==="explicit"?"原文明确支持（AI 判断，需核对）":"AI 推断"}</p>}
      <p className="preserve">理由：{item.reason}</p><details><summary>查看原文依据 · {item.evidence.length} 处</summary>{item.evidence.map((q,i)=><blockquote className="evidence" key={i}><a href={`/?entry=${encodeURIComponent(q.entry_id)}`}>来源记录 · {q.field}</a><p>{q.quote}</p></blockquote>)}</details>
      {item.decision==="pending"&&errors?.[item.id]&&<p role="alert" className="danger">{errors[item.id]}；仍可拒绝这项。</p>}
      {entry.status==="draft"&&item.decision==="pending"?<><label>反馈（可选）<input maxLength={2000} placeholder="例如：这两个概念有关，但不是同义词" value={feedback[item.id]||""} onChange={e=>setFeedback(v=>({...v,[item.id]:e.target.value}))}/></label><div className="review-buttons"><button className="button secondary" disabled={busy} onClick={()=>void onReview(item.id,false,feedback[item.id]||"")}>拒绝这项</button><button className="button primary" disabled={busy||!base||!errors||!!errors[item.id]} onClick={()=>void onReview(item.id,true,feedback[item.id]||"")}>接受这项</button></div></>:item.feedback&&<p className="small muted">审核反馈：{item.feedback}</p>}
    </article>)}
  </section>;
}
