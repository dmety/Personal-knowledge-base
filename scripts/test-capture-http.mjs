import assert from 'node:assert/strict';
const origin=process.env.KNOWLEDGE_TEST_URL||'http://127.0.0.1:5173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Only local preview may be tested');
const cookie='__sites_local_auth=1',ids=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=','base64');
async function api(body,path='/api/knowledge'){const r=await fetch(origin+path,{headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function capture(key,auth=true,content=''){const f=new FormData();f.set('action','capture');f.set('request_id',key);f.set('content',content);for(const name of ['照片甲.png','照片乙.png'])f.append('files',new File([png],name,{type:'image/png'}));const r=await fetch(origin+'/api/knowledge',{method:'POST',headers:auth?{Cookie:cookie}:{},body:f});return {status:r.status,data:await r.json()};}
const rpc=async(name,args,auth=true)=>{const r=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return {status:r.status,data:await r.json()};};
try{
  assert.equal((await capture(crypto.randomUUID(),false)).status,401);
  const key=crypto.randomUUID(),saved=await capture(key);assert.equal(saved.status,200);let e=saved.data.entry;ids.push(e.id);assert.equal(e.attachments.length,2);assert.match(e.short_id,/^K-\d{5,}$/);
  assert.equal((await capture(key)).data.entry.id,e.id);assert.equal((await capture(key,true,'不同内容')).status,409);
  assert.equal((await api(null,'/api/knowledge?id='+e.short_id)).data.entry.id,e.id);
  const images=await rpc('get_knowledge_images',{id:e.short_id});assert.equal(images.status,200);assert.equal(images.data.result.content.filter(c=>c.type==='image').length,2);assert.equal(images.data.result.content[1].data,png.toString('base64'));
  assert.equal((await rpc('get_knowledge_images',{id:e.short_id},false)).status,401);
  const collected=await rpc('collect_and_organize',{raw_content:'我的原话：这是一个收集测试。',title:'收集整理 HTTP 验收',content:'这是整理正文。',summary:'测试草稿',sources:[]});assert.ok(!collected.data.result.isError);const draft=JSON.parse(collected.data.result.content[0].text);ids.push(draft.id);assert.equal(draft.status,'draft');assert.equal(draft.original_content,'我的原话：这是一个收集测试。');assert.ok(draft.short_id);
  const directory=JSON.parse((await rpc('get_topic_directory',{})).data.result.content[0].text);const topic=directory.topics[0];assert.ok(topic);
  const org=await rpc('propose_knowledge_organization',{entry_id:draft.short_id,entry_version:draft.version,directory_revision:directory.revision,items:[{action:'classify',topic_id:topic.id,reason:'本地分类验收',evidence:[{entry_id:draft.short_id,field:'content',quote:'这是整理正文。'}]}]});assert.ok(!org.data.result.isError);const proposal=JSON.parse(org.data.result.content[0].text);ids.push(proposal.id);
  const detail=(await api(null,'/api/knowledge?id='+draft.short_id)).data;assert.ok(detail.organizations.some(o=>o.entry.id===proposal.id));
  const reviewed=await api({action:'organization-review',id:proposal.short_id,item_id:proposal.organization_proposal.items[0].id,version:proposal.version,accept:true});assert.equal(reviewed.status,200);
  const after=(await api(null,'/api/knowledge?id='+draft.short_id)).data.entry;assert.equal(after.original_content,draft.original_content);assert.equal(after.status,'draft');assert.ok(after.topic_paths.length);
  console.log('PASS: capture + multi-image retries, short references, protected MCP images, combined collection, unified review and original preservation.');
}finally{
  for(const id of ids){const r=await api(null,'/api/knowledge?id='+id);if(r.status===200&&!r.data.entry.organization_proposal)await api({action:'update',id,entry:{version:r.data.entry.version,status:'archived'}});}
}
