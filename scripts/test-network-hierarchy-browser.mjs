import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:5173';
const now=new Date().toISOString();
const entry=(id,title,paths)=>({id,title,content:'层级图谱测试正文',summary:'',kind:'source',status:'reviewed',source_url:'',source_title:'',evidence:'',notes:'',topic_paths:paths,topic_ids:[],relations:[],organization_proposal:null,related_recommendations:[],tags:[],related_ids:[],created_at:now,updated_at:now,created_by:'human',revision_of:null,base_version:null,reason:'',sources:[],attachments:[],version:1});
const a=entry('a','Vue 基础',['技术 / Vue']),b=entry('b','框架比较',['技术 / Vue','技术 / React']);
b.relations=[{target_id:'a',kind:'contrast',note:'两个记录的正式对比依据'}];
a.related_recommendations=[{id:'rec',action:'record_relation',target_id:'b',reason:'推荐依据',strength:'weak',basis:'inference',evidence:[],decision:'accepted',feedback:''}];
const topics=[['root','技术',null,'技术'],['vue','Vue','root','技术 / Vue'],['react','React','root','技术 / React'],['empty','空主题',null,'空主题']].map(([id,name,parent_id,path],i)=>({id,name,parent_id,path,position:i,version:1,definition:'',scope:'',aliases:[],representative_ids:[],links:id==='vue'?[{target_id:'react',note:'两个框架的主题关联',strength:'strong',basis:'inference',evidence:[]}]:[],count:id==='empty'?0:2,files:[a,b].filter(e=>e.topic_paths.includes(path)).map(e=>({id:e.id,title:e.title,kind:e.kind,version:e.version}))}));
await mkdir('outputs',{recursive:true});
const browser=await chromium.launch({headless:true,});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'__sites_local_auth',value:'1',url:base}]);
  await context.addInitScript(()=>localStorage.setItem('zhixu-workspace-expanded','true'));const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/topics',r=>r.fulfill({json:{revision:1,topics,unclassified_count:0}}));
  await page.route('**/api/knowledge?*',r=>{const p=new URL(r.request().url()).searchParams;return r.fulfill({json:p.has('id')?{entry:[a,b].find(e=>e.id===p.get('id')),history:[],base:null}:{entries:[a,b],counts:{inbox:0,draft:0,reviewed:2,archived:0},tags:[],total:2,last_export:null}});});
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/knowledge?')),page.goto(base)]);if(width===390)await page.getByRole('button',{name:'展开导航'}).click();
  await page.waitForTimeout(500);if(await page.getByRole('button',{name:'我的工作空间',exact:true}).getAttribute('aria-expanded')!=='true')await page.getByRole('button',{name:'我的工作空间',exact:true}).click();await page.getByRole('button',{name:'知识网络',exact:true}).click();
  await page.locator('.force-node.topic').first().waitFor();assert.equal(await page.locator('.force-node.topic').count(),4);assert.equal(await page.locator('.force-node.record').count(),2);
  assert.equal(await page.locator('[data-edge-kind="hierarchy"]').count(),2);assert.equal(await page.locator('[data-edge-kind="membership"]').count(),3);assert.equal(await page.locator('[data-edge-kind="topic_link"]').count(),1);
  await page.getByLabel('显示推荐虚线').check();assert.equal(await page.locator('[data-edge-kind="recommendation"]').count(),1);
  await page.screenshot({path:`outputs/network-hierarchy-${width}.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.locator('[data-node-id="topic:vue"] rect').click();assert.equal(await page.getByLabel('筛选主题').inputValue(),'技术 / Vue');assert.equal(await page.locator('[data-node-id="topic:empty"]').count(),0);
  await page.getByLabel('网络视图').selectOption('records');assert.equal(await page.locator('.force-node.topic').count(),0);await page.getByRole('button',{name:'暂停布局'}).click();
  await page.locator('[data-node-id="a"] circle').click();await page.getByRole('heading',{name:'Vue 基础',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('entry'),'a');assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: desktop/mobile topic hierarchy, empty topics, multiple memberships, topic links, recommendation toggle, branch navigation, record view and detail; no JS errors or horizontal overflow. Mock API, no user data writes.');
}finally{await browser.close();}
