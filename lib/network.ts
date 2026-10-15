import type { Entry } from './model';
export function topicTree(entries:Entry[]){const topics=new Set<string>();for(const e of entries)for(const path of e.topic_paths){const p=path.split(' / ');for(let i=1;i<=p.length;i++)topics.add(p.slice(0,i).join(' / '));}return [...topics].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
export function selectNetwork(entries:Entry[],focus:string,topic:string,depth:number,status:string,query:string,limit=60){
  entries=entries.filter(e=>!e.organization_proposal&&!e.revision_of);
  const pool=entries.filter(e=>status?e.status===status:e.status!=='archived');const byId=new Map(pool.map(e=>[e.id,e]));
  const edges=pool.flatMap(e=>[...e.relations.map(r=>({source:e.id,target:r.target_id,kind:r.kind,note:r.note,pending:e.status==='draft'})),...e.related_ids.filter(id=>!e.relations.some(r=>r.target_id===id)).map(id=>({source:e.id,target:id,kind:'related',note:'已有普通关联',pending:e.status==='draft'}))]).filter(r=>byId.has(r.target)&&r.target!==r.source);
  let ids=new Set(pool.filter(e=>(!topic||e.topic_paths.some(p=>p===topic||p.startsWith(topic+' / ')))&&(!query||[e.title,...e.tags,...e.topic_paths].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(e=>e.id));
  if(focus){ids=new Set(byId.has(focus)?[focus]:[]);for(let i=0;i<depth;i++){const next=new Set(ids);for(const r of edges)if(ids.has(r.source)||ids.has(r.target)){next.add(r.source);next.add(r.target);}ids=next;}}
  const selected=pool.filter(e=>ids.has(e.id));if(focus)selected.sort((a,b)=>Number(b.id===focus)-Number(a.id===focus));const nodes=selected.slice(0,limit),visible=new Set(nodes.map(e=>e.id));return {nodes,edges:edges.filter(r=>visible.has(r.source)&&visible.has(r.target)),total:selected.length};
}

import type { TopicItem } from './topics';
export type NetworkNode={id:string;title:string;type:'record'|'topic';status:Entry['status'];path?:string;level?:number};
export type NetworkEdge={source:string;target:string;kind:string;note:string;pending:boolean;category:'relation'|'hierarchy'|'membership'|'topic_link'|'recommendation'};
export type KnowledgeGraph={nodes:NetworkNode[];edges:NetworkEdge[];total:number;hiddenEdges:number};
export const networkEdgeLabels:Record<string,string>={related:'关联',supplement:'补充说明',depends_on:'依赖',contrast:'对比',example:'应用案例',hierarchy:'子主题',membership:'所属主题',topic_link:'主题关联',recommendation:'相关内容推荐'};
export function buildKnowledgeGraph(entries:Entry[],directory:TopicItem[],options:{focus:string;topic:string;depth:number;status:string;query:string;mode:'topics'|'records';recommendations:boolean;hideIsolated:boolean}):KnowledgeGraph {
 const {focus,topic,depth,status,query,mode,recommendations,hideIsolated}=options;
 const records=entries.filter(e=>!e.organization_proposal&&!e.revision_of&&(status?e.status===status:e.status!=='archived'));
 const recordIds=new Set(records.map(e=>e.id));
 const recommended:NetworkEdge[]=recommendations?records.flatMap(e=>e.related_recommendations.filter(r=>r.decision==='accepted'&&r.strength==='weak'&&r.target_id&&recordIds.has(r.target_id)&&r.target_id!==e.id).map(r=>({source:e.id,target:r.target_id!,kind:'recommendation',note:r.reason,pending:false,category:'recommendation' as const}))):[];
 // Include recommendations in local neighborhoods only when explicitly enabled.
 const selection=selectNetwork(records.map(e=>({...e,related_ids:[...e.related_ids,...recommended.filter(r=>r.source===e.id).map(r=>r.target)]})),focus,topic,depth,status,query);
 const nodes:NetworkNode[]=selection.nodes.map(e=>({id:e.id,title:e.title,type:'record',status:e.status}));
 const formal=selectNetwork(records,'','',1,status,'',records.length).edges;
 const edges:NetworkEdge[]=[...formal.map(e=>({...e,category:'relation' as const})),...recommended];
 let topicTotal=0;
 if(mode==='topics'){
  const included=new Set<string>();const byPath=new Map(directory.map(t=>[t.path,t]));const byId=new Map(directory.map(t=>[t.id,t]));
  const add=(t:TopicItem)=>{while(t&&!included.has(t.id)){included.add(t.id);t=byId.get(t.parent_id!)!;}};
  if(!focus)for(const t of directory)if((!topic||t.path===topic||t.path.startsWith(topic+' / '))&&(!query||[t.name,t.path,...t.aliases].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())))add(t);
  for(const e of selection.nodes)for(const path of e.topic_paths){const t=byPath.get(path);if(t)add(t);}
  topicTotal=included.size;
  // Ancestors precede children in the directory; keep a separate topic budget.
  const topics=directory.filter(t=>included.has(t.id)).sort((a,b)=>a.path.split(' / ').length-b.path.split(' / ').length).slice(0,100);
  const topicId=(id:string)=>'topic:'+id;const visibleTopics=new Set(topics.map(t=>t.id));
  for(const t of topics){nodes.push({id:topicId(t.id),title:t.name,type:'topic',status:'reviewed',path:t.path,level:t.path.split(' / ').length});
   if(t.parent_id&&visibleTopics.has(t.parent_id))edges.push({source:topicId(t.parent_id),target:topicId(t.id),kind:'hierarchy',note:t.path,pending:false,category:'hierarchy'});
   for(const link of t.links)if(byId.has(link.target_id)&&(link.strength!=='weak'||recommendations))edges.push({source:topicId(t.id),target:topicId(link.target_id),kind:'topic_link',note:link.note,pending:false,category:link.strength==='weak'?'recommendation':'topic_link'});
  }
  for(const e of selection.nodes)for(const path of e.topic_paths){const t=byPath.get(path);if(t&&visibleTopics.has(t.id))edges.push({source:topicId(t.id),target:e.id,kind:'membership',note:path,pending:e.status==='draft',category:'membership'});}
 }
 const ids=new Set(nodes.map(n=>n.id));const visibleEdges=edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
 const connected=new Set(visibleEdges.flatMap(e=>[e.source,e.target]));
 return {nodes:hideIsolated?nodes.filter(n=>connected.has(n.id)||n.id===focus):nodes,edges:visibleEdges,total:selection.total+topicTotal,hiddenEdges:edges.filter(e=>ids.has(e.source)!==ids.has(e.target)).length};
}
