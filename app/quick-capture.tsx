"use client";
import {useEffect,useRef,useState} from "react";
import {Camera,ImagePlus,X,CheckCircle2} from "lucide-react";
import {entrySchema,type Entry} from "@/lib/model";

type Draft={text:string;files:File[];requestId:string;attempted:boolean};
const fresh=():Draft=>({text:"",files:[],requestId:crypto.randomUUID(),attempted:false});
function draftStore(key:string,value?:Draft|null):Promise<Draft|undefined>{
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open("zhixu-capture",1);
    open.onupgradeneeded=()=>open.result.createObjectStore("drafts");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction("drafts",value===undefined?"readonly":"readwrite"),store=tx.objectStore("drafts");const request=value===undefined?store.get(key):value===null?store.delete(key):store.put(value,key);
      tx.oncomplete=()=>{resolve(value===undefined?request.result:undefined);db.close();};tx.onerror=()=>{reject(tx.error);db.close();};};
  });
}
export default function QuickCapture({owner,onSaved,onClose}:{owner:string;onSaved:(entry:Entry)=>void;onClose:()=>void}){
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[warning,setWarning]=useState(""),[previews,setPreviews]=useState<string[]>([]);
  const saving=useRef(false),fileInput=useRef<HTMLInputElement>(null),cameraInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{let active=true;void draftStore(owner).then(v=>{if(active)setDraft(v||fresh());}).catch(()=>{if(active){setDraft(fresh());setWarning("此浏览器无法保存本地草稿，请保持页面打开直到保存成功。");}});return()=>{active=false;};},[owner]);
  useEffect(()=>{if(draft)void draftStore(owner,draft).catch(()=>setWarning("本地草稿未能保存，请保持页面打开。"));},[draft,owner]);
  useEffect(()=>{const urls=(draft?.files||[]).map(f=>URL.createObjectURL(f));setPreviews(urls);return()=>urls.forEach(u=>URL.revokeObjectURL(u));},[draft?.files]);
  const locked=busy||!!draft?.attempted;
  function add(files:FileList|null){if(!files||!draft||locked)return;const picked=Array.from(files);if(picked.some(f=>!["image/jpeg","image/png","image/webp"].includes(f.type))){setError("支持 JPEG、PNG、WebP。HEIC 等格式请先转换，再选择照片。");return;}
    const next=[...draft.files,...picked];if(next.length>10||next.some(f=>!f.size||f.size>20*1024*1024)||next.reduce((n,f)=>n+f.size,0)>40*1024*1024){setError("最多 10 张，每张不超过 20 MB，总量不超过 40 MB。");return;}setError("");setNotice("");setDraft({...draft,files:next});
  }
  async function save(){if(!draft||saving.current||!draft.text.trim()&&!draft.files.length)return;saving.current=true;setBusy(true);setError("");setNotice("");const pending={...draft,attempted:true};setDraft(pending);
    try{
      await draftStore(owner,pending).catch(()=>setWarning("本地草稿未能保存，请保持页面打开。"));
      const form=new FormData();form.set("action","capture");form.set("request_id",pending.requestId);form.set("content",pending.text);pending.files.forEach(f=>form.append("files",f));
      const response=await fetch("/api/knowledge",{method:"POST",body:form,signal:AbortSignal.timeout(120000)});const result=await response.json() as {error?:string;entry:unknown};if(!response.ok)throw new Error(result.error||"保存失败");const entry=entrySchema.parse(result.entry);
      const next=fresh();await draftStore(owner,next).catch(()=>setWarning("已保存到知识库，但本地草稿清理失败。再次打开可能显示旧草稿，重试不会重复创建。"));setDraft(next);setNotice(`${entry.short_id||"记录"} 已保存到收集箱`);onSaved(entry);
    }catch(e){setError(`${(e as Error).message}。草稿仍保留，请重试；本次内容暂时锁定以避免重复提交。`);}
    finally{saving.current=false;setBusy(false);}
  }
  return <section className="quick-capture" aria-label="随手记">
    <div className="page-heading"><div><div className="eyebrow">CAPTURE A MOMENT</div><h1>随手记</h1><p>几句话、几张照片，先存下来，整理交给以后。</p></div><button className="button secondary" disabled={busy} onClick={onClose}>返回知识库</button></div>
    {!draft?<p role="status">正在恢复草稿…</p>:<div className="card capture-card">
      <label className="capture-label" htmlFor="capture-text">记点什么……</label><textarea id="capture-text" rows={6} maxLength={100000} placeholder="写下想法，粘贴一段内容或网址；只放照片也可以。" value={draft.text} disabled={locked} onChange={e=>{setDraft({...draft,text:e.target.value});setNotice("");}}/>
      <div className="capture-photos">{previews.map((url,i)=><figure key={url}><img src={url} alt={`待保存照片 ${i+1}`}/><figcaption>{draft.files[i]?.name}</figcaption><button disabled={locked} aria-label={`移除照片 ${i+1}`} onClick={()=>setDraft({...draft,files:draft.files.filter((_,index)=>index!==i)})}><X size={16}/></button></figure>)}</div>
      <input ref={fileInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{add(e.target.files);e.target.value="";}}/>
      <input ref={cameraInput} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{add(e.target.files);e.target.value="";}}/>
      <div className="capture-tools"><button className="button secondary" disabled={locked} onClick={()=>cameraInput.current?.click()}><Camera size={18}/>拍照</button><button className="button secondary" disabled={locked} onClick={()=>fileInput.current?.click()}><ImagePlus size={18}/>选择照片</button><span className="muted small">{draft.files.length}/10 张</span></div>
      {warning&&<p className="small" role="status">{warning}</p>}{error&&<p className="danger" role="alert">{error}</p>}{notice&&<p className="capture-success" role="status"><CheckCircle2 size={18}/>{notice}</p>}
      <div className="form-footer"><span className="muted small">文字和照片任选其一。未保存内容会保留在本机草稿中。</span><button className="button primary" disabled={busy||!draft.text.trim()&&!draft.files.length} onClick={()=>void save()}>{busy?"正在保存文字和照片…":draft.attempted?"重试保存":"存入收集箱"}</button></div>
    </div>}
  </section>;
}
