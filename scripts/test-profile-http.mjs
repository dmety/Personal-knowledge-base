import assert from 'node:assert/strict';
const origin=process.env.KNOWLEDGE_TEST_URL||'http://127.0.0.1:5173';if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Local tests only');
async function profile(body,auth=true){const r=await fetch(origin+'/api/profile',{headers:{...(auth?{Cookie:'__sites_local_auth=1'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function shared(){const r=await fetch(origin+'/mcp',{method:'POST',headers:{Cookie:'__sites_local_auth=1','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_personal_background',arguments:{}}})});const d=await r.json();assert.ok(!d.result.isError);return JSON.parse(d.result.content[0].text);}
assert.equal((await profile(null,false)).status,401);const original=(await profile()).data.profile;let current=original;
try{
  const fixture={...original,groups:[{id:'fixture',name:'可自定义的测试背景',repeatable:false,fields:[{id:'fixture-field',name:'虚构称呼',type:'text',value:'本地验收资料'}],rows:[]}]};
  const saved=await profile(fixture);assert.equal(saved.status,200);current=saved.data.profile;
  assert.equal((await shared()).available,true);assert.equal((await shared()).groups[0].name,fixture.groups[0].name);
  assert.equal((await profile(fixture)).status,409);
  // Legacy backups may still carry a disabled flag: it must neither leak into the new profile nor block reads.
  const legacy=await profile({...current,share_with_plugin:false});assert.equal(legacy.status,200);current=legacy.data.profile;
  const available=await shared();assert.equal(available.available,true);assert.equal(available.groups[0].name,fixture.groups[0].name);assert.equal('share_with_plugin' in current,false);
  const invalid=await profile({...current,groups:[...current.groups,current.groups[0]]});assert.equal(invalid.status,400);
  const blocked=await fetch(origin+'/api/profile',{method:'POST',headers:{Cookie:'__sites_local_auth=1','Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify(current)});assert.equal(blocked.status,403);
  console.log('PASS: private profile read/write, custom groups, version conflicts, direct authenticated plugin reads, invalid structure and cross-origin protection.');
}finally{await profile({...original,version:current.version});}
