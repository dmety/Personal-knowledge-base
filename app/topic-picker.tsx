"use client";
import { useEffect, useState } from "react";
import { loadTopics } from "./topic-sidebar";
import type { TopicItem } from "@/lib/topics";
export default function TopicPicker({paths,onChange}:{paths:string[];onChange:(paths:string[])=>void}){
  const [topics,setTopics]=useState<TopicItem[]>([]),[query,setQuery]=useState(""),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;void loadTopics().then(d=>{if(!cancelled)setTopics(d.topics);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
  return <fieldset className="topic-picker"><legend>所属主题 · 可多选</legend><input aria-label="查找主题目录" placeholder="查找主题…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="topic-picker-list">{topics.filter(t=>t.path.includes(query)).map(t=><label key={t.id}><input type="checkbox" checked={paths.includes(t.path)} disabled={!paths.includes(t.path)&&paths.length>=20} onChange={e=>onChange(e.target.checked?[...paths,t.path]:paths.filter(p=>p!==t.path))}/><span title={t.path}>{t.path}</span></label>)}{!topics.length&&!error&&<p className="muted small">暂无主题，请从侧栏新建。</p>}</div>{paths.filter(p=>!topics.some(t=>t.path===p)).map(p=><label key={p}><input type="checkbox" checked onChange={()=>onChange(paths.filter(path=>path!==p))}/>{p}</label>)}<p className="muted small">已选 {paths.length} 个主题；不选择即为未分类。</p>{error&&<p role="alert">{error}</p>}</fieldset>;
}
