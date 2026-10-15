import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const origin='http://127.0.0.1:5173',cookie='__sites_local_auth=1';
async function call(path,body){const r=await fetch(origin+path,{headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
async function rpc(name,args){const d=await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});assert.ok(!d.result.isError,JSON.stringify(d));return JSON.parse(d.result.content[0].text);}
const prefix='组织验收'+Date.now(),ids=[];let proposal;
const browser=await chromium.launch({headless:true,});
const errors=[];
try{
  await mkdir('outputs',{recursive:true});
  let base=(await call('/api/knowledge',{action:'create',entry:{title:prefix,content:'间隔复习可以帮助学习。主动回忆也与学习有关。',topic_paths:[prefix+' / 学习方法']}})).entry;ids.push(base.id);
  const target=(await call('/api/knowledge',{action:'create',entry:{title:prefix+'目标',content:'主动回忆要求回想所学内容。'}})).entry;ids.push(target.id);
  let directory=await rpc('get_topic_directory',{}),theme=directory.topics.find(t=>t.name==='学习方法'&&t.path.startsWith(prefix));assert.ok(theme);
  const invalid=await call('/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'create_knowledge_draft',arguments:{title:'不应创建主题',content:'正文',sources:[],topic_paths:[prefix+'未批准']}}});assert.ok(invalid.result.isError);
  assert.ok(!(await rpc('get_topic_directory',{})).topics.some(t=>t.name===prefix+'未批准'));
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'__sites_local_auth',value:'1',url:origin}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:theme.name+'主题操作',exact:true}).last().click();await page.getByRole('button',{name:'含义与别名',exact:true}).click();
  await page.getByLabel('主题定义',{exact:true}).fill('研究如何有效学习的方法。');await page.getByLabel('别名（每行一个）',{exact:true}).fill('学习策略');await page.getByRole('button',{name:'确认',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  directory=await rpc('get_topic_directory',{});assert.ok(directory.topics.find(t=>t.id===theme.id).aliases.includes('学习策略'));
  const candidates=await rpc('find_organization_candidates',{entry_id:base.id,queries:['学习策略','主动回忆']});assert.ok(candidates.topics.some(t=>t.id===theme.id));
  const args={entry_id:base.id,entry_version:base.version,directory_revision:directory.revision,items:[{action:'classify',topic_id:theme.id,reason:'资料讨论有效学习',evidence:[{entry_id:base.id,quote:'间隔复习可以帮助学习。'}]},{action:'record_relation',target_id:target.id,strength:'weak',basis:'inference',reason:'两条资料都讨论学习与回忆，暂不确定具体关系',evidence:[{entry_id:base.id,quote:'主动回忆也与学习有关。'},{entry_id:target.id,quote:'主动回忆要求回想所学内容。'}]}]};
  const countsBefore=await call('/api/topics'),listingBefore=await call('/api/knowledge');
  proposal=await rpc('propose_knowledge_organization',args);assert.equal((await rpc('propose_knowledge_organization',args)).id,proposal.id);
  assert.equal((await call('/api/topics')).unclassified_count,countsBefore.unclassified_count);
  assert.equal((await call('/api/knowledge')).total,listingBefore.total);
  await page.goto(origin+'/?entry='+proposal.id);await page.getByRole('heading',{name:'分类与关系建议',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'审核通过',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'编辑记录',exact:true}).count(),0);
  await page.locator('.organization-item').first().getByRole('button',{name:'接受这项',exact:true}).click();await page.locator('.organization-item').first().getByText('已接受',{exact:true}).waitFor();await page.screenshot({path:'outputs/organization-desktop.png',fullPage:true});
  base=(await call('/api/knowledge?id='+base.id)).entry;assert.equal(base.content,'间隔复习可以帮助学习。主动回忆也与学习有关。');assert.equal(base.status,'inbox');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.addCookies([{name:'__sites_local_auth',value:'1',url:origin}]);const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(origin+'/?entry='+proposal.id);await phone.locator('.organization-item').last().getByRole('button',{name:'接受这项',exact:true}).waitFor();assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:'outputs/organization-mobile.png',fullPage:true});
  await phone.locator('.organization-item').last().getByRole('button',{name:'接受这项',exact:true}).click();await phone.locator('.organization-item').last().getByText('已接受',{exact:true}).waitFor();base=(await call('/api/knowledge?id='+base.id)).entry;assert.equal(base.relations.length,0);assert.equal(base.related_recommendations.length,1);
  await phone.goto(origin+'/?entry='+base.id);await phone.getByText('未建立正式关系',{exact:false}).waitFor();assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:'outputs/organization-mobile-record.png',fullPage:true});assert.deepEqual(errors,[]);
  // Two independently submitted same-theme proposals must remain reviewable in sequence.
  base=(await call('/api/knowledge?id='+base.id)).entry;
  const currentTarget=(await call('/api/knowledge?id='+target.id)).entry;
  directory=await rpc('get_topic_directory',{});
  const themeItem={action:'new_topic',name:prefix+'求职',definition:'招聘与简历准备',scope:'实习岗位信息',reason:'测试独立主题',evidence:[{entry_id:base.id,quote:'间隔复习可以帮助学习。'}]};
  const first=await rpc('propose_knowledge_organization',{entry_id:base.id,entry_version:base.version,directory_revision:directory.revision,items:[themeItem]});
  const second=await rpc('propose_knowledge_organization',{entry_id:target.id,entry_version:currentTarget.version,directory_revision:directory.revision,items:[{...themeItem,evidence:[{entry_id:target.id,quote:'主动回忆要求回想所学内容。'}]}]});
  for(const pending of [first,second]){
    await page.goto(origin+'/?entry='+pending.id);
    const accept=page.getByRole('button',{name:'接受这项',exact:true});await accept.waitFor();
    await accept.click();await page.locator('.organization-item').getByText('已接受',{exact:true}).waitFor();
    assert.equal(await page.getByText('原记录或主题目录已变化，或目录尚未读取完成。请重新分析过期建议；仍可拒绝项目。',{exact:true}).count(),0);
  }
  const matching=(await rpc('get_topic_directory',{})).topics.filter(t=>t.name===themeItem.name);assert.equal(matching.length,1);
  const finalBase=(await call('/api/knowledge?id='+base.id)).entry,finalTarget=(await call('/api/knowledge?id='+target.id)).entry;
  assert.ok(finalBase.topic_ids.includes(matching[0].id)&&finalTarget.topic_ids.includes(matching[0].id));
  assert.deepEqual(errors,[]);
  console.log('PASS: proposal-free counts, sequential independent proposals reuse one theme, per-item desktop/mobile review, unchanged original content/status, no page errors or overflow.');
}finally{
  if(proposal){const p=(await call('/api/knowledge?id='+proposal.id)).entry;if(p.status==='draft')for(const item of p.organization_proposal.items.filter(i=>i.decision==='pending')){const current=(await call('/api/knowledge?id='+p.id)).entry;await call('/api/knowledge',{action:'organization-review',id:p.id,item_id:item.id,version:current.version,accept:false});}}
  for(const id of ids){const e=(await call('/api/knowledge?id='+id)).entry;await call('/api/knowledge',{action:'update',id,entry:{version:e.version,status:'archived'}});}await browser.close();
}
