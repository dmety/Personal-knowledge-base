import assert from 'node:assert/strict';
const origin=process.env.KNOWLEDGE_TEST_URL||'http://127.0.0.1:5173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Only local preview may be tested');
const cookie='__sites_local_auth=1';
async function call(path,body,auth=true){const r=await fetch(origin+path,{headers:{...(auth?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};}
const ids=[];
try{
  assert.equal((await call('/api/knowledge',null,false)).status,401);
  assert.equal((await call('/api/knowledge?network=1',null,false)).status,401);
  assert.equal((await call('/api/knowledge?id=missing&asset=missing',null,false)).status,401);
  assert.equal((await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search_knowledge',arguments:{query:'测试'}}},false)).status,401);
  const rpc=async(name,args)=>(await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})).data;
  const create=await call('/api/knowledge',{action:'create',entry:{title:'验收测试：并发审核',content:'原始内容',source_url:'https://example.com/evidence',tags:['验收测试']}});assert.equal(create.status,200);let e=create.data.entry;ids.push(e.id);
  const ready=await call('/api/knowledge',{action:'update',id:e.id,entry:{version:e.version,status:'reviewed'}});assert.equal(ready.status,200);e=ready.data.entry;
  const target=await call('/api/knowledge',{action:'create',entry:{title:'网络目标',content:'支持关系的资料',topic_paths:['验收 / 网络']}});assert.equal(target.status,200);ids.push(target.data.entry.id);
  const proposal=await rpc('propose_knowledge_revision',{id:e.id,proposed_content:'AI 建议内容',reason:'本地验收',sources:[],topic_paths:['验收 / 网络'],relations:[{target_id:target.data.entry.id,kind:'depends_on',note:'本地关联验收'}]});assert.ok(!proposal.result.isError);const draft=JSON.parse(proposal.result.content[0].text);ids.push(draft.id);
  assert.equal((await call('/api/knowledge?id='+e.id)).data.entry.content,'原始内容');
  const accepted=await call('/api/knowledge',{action:'review',id:draft.id,version:draft.version,accept:true});assert.equal(accepted.status,200);e=accepted.data.entry;assert.equal(e.content,'AI 建议内容');assert.deepEqual(e.topic_paths,['验收 / 网络']);assert.equal(e.relations[0].target_id,target.data.entry.id);assert.ok((await call('/api/knowledge?network=1')).data.entries.some(v=>v.id===e.id));
  const conflict=await call('/api/knowledge',{action:'update',id:e.id,entry:{version:1,content:'不能写入'}});assert.equal(conflict.status,409);
  const staleRpc=await rpc('propose_knowledge_revision',{id:e.id,proposed_content:'过期建议',reason:'版本冲突'});const stale=JSON.parse(staleRpc.result.content[0].text);ids.push(stale.id);
  const edited=await call('/api/knowledge',{action:'update',id:e.id,entry:{version:e.version,content:'本人更新'}});assert.equal(edited.status,200);e=edited.data.entry;
  assert.equal((await call('/api/knowledge',{action:'review',id:stale.id,version:stale.version,accept:true})).status,409);
  const raced=await Promise.all(['并发内容 A','并发内容 B'].map(content=>call('/api/knowledge',{action:'update',id:e.id,entry:{version:e.version,content}})));
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);e=(await call('/api/knowledge?id='+e.id)).data.entry;
  for(const [name,type,bytes] of [['验收.png','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=','base64')],['验收.pdf','application/pdf',Buffer.from('%PDF-1.4\n%%EOF')]]){
    const f=new FormData();f.set('action','upload');f.set('id',e.id);f.set('file',new File([bytes],name,{type}));const r=await fetch(origin+'/api/knowledge',{method:'POST',headers:{Cookie:cookie},body:f});assert.equal(r.status,200,await r.clone().text());e=(await r.json()).entry;
  }
  assert.equal(e.attachments.length,2);
  const asset=await fetch(origin+`/api/knowledge?id=${e.id}&asset=${e.attachments[0].id}`,{headers:{Cookie:cookie}});assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/png');
  const zip=await fetch(origin+'/api/knowledge?export=zip',{headers:{Cookie:cookie}});assert.equal(zip.status,200);const bytes=await zip.arrayBuffer();assert.ok(bytes.byteLength>0);
  const form=new FormData();form.set('action','preview-import');form.set('file',new File([bytes],'备份.zip',{type:'application/zip'}));const preview=await fetch(origin+'/api/knowledge',{method:'POST',headers:{Cookie:cookie},body:form});assert.equal(preview.status,200);const p=await preview.json();assert.ok(p.duplicates.length>=ids.length);assert.equal(p.missingAssets.length,0);
  const noMatch=await rpc('search_knowledge',{query:'没有依据-'+crypto.randomUUID()});assert.equal(JSON.parse(noMatch.result.content[0].text).message,'知识库中没有找到足够依据');
  const cross=await fetch(origin+'/api/knowledge',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({action:'demo'})});assert.equal(cross.status,403);
  console.log('PASS: HTTP authentication, D1 writes/history/version conflicts, MCP drafts, R2 PNG/PDF, ZIP preview, no evidence, cross-origin write rejection.');
}finally{
  for(const id of ids){const r=await call('/api/knowledge?id='+id);if(r.status===200&&r.data.entry.status!=='archived')await call('/api/knowledge',{action:'update',id,entry:{version:r.data.entry.version,status:'archived'}});}
  console.log('Local test records archived; no production data touched.');
}

