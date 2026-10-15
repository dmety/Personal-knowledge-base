"use client";
import type {Entry} from "@/lib/model";
export default function RecordAttachments({entry}:{entry:Entry}){
  return <div className="record-photos">{entry.attachments.map((a,i)=>a.mime.startsWith("image/")?<a key={`${a.id}-${i}`} href={`/api/knowledge?id=${entry.id}&asset=${a.id}`} target="_blank" rel="noopener noreferrer"><img loading="lazy" src={`/api/knowledge?id=${entry.id}&asset=${a.id}`} alt={a.name}/><span>{a.name}</span></a>:null)}</div>;
}
