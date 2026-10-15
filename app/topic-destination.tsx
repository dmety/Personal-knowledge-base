"use client";
import { useState } from "react";
import { Folder } from "lucide-react";
import type { TopicItem } from "@/lib/topics";
export default function TopicDestination({topics,exclude,value,onChange}:{topics:TopicItem[];exclude:string;value:string|null;onChange:(id:string)=>void}){
  const [query,setQuery]=useState("");const items=topics.filter(t=>t.id!==exclude&&t.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <fieldset className="topic-destination"><legend>选择目标主题</legend><input autoFocus aria-label="搜索目标主题" placeholder="搜索主题…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="topic-destination-list">{items.map(t=><label key={t.id} title={t.path} style={{paddingLeft:8+(t.path.split(" / ").length-1)*16}}><input type="radio" name="destination" value={t.id} checked={value===t.id} onChange={()=>onChange(t.id)}/><Folder size={14}/><span>{query?t.path:t.name}</span></label>)}{!items.length&&<p className="muted small">没有可用目标主题。</p>}</div></fieldset>;
}
