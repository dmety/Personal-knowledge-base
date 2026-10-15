import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8787';const headers={'oai-authenticated-user-id':'legacy-browser-tests','oai-authenticated-user-email':'fixture@sites.test','Content-Type':'application/json'};
async function api(body){const r=await fetch(base+'/api/knowledge',{method:'POST',headers,body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d.entry;}
const browser=await chromium.launch({headless:true,});let entry;
try{
 entry=await api({action:'create',entry:{title:'旧格式详情回归',content:'## 旧正文\n\n旧记录缺少知识网络字段也能查看。'}});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,extraHTTPHeaders:headers});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/knowledge?id=*',async route=>{const r=await route.fetch();const d=await r.json();if(d.entry){delete d.entry.topic_paths;delete d.entry.relations;}await route.fulfill({response:r,json:d});});
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/knowledge?')&&r.status()===200),page.goto(base)]);
  if(viewport.width<680)await page.getByRole('button',{name:'展开导航'}).click();await page.getByRole('button',{name:'知识网络',exact:true}).click();await page.getByPlaceholder('标题、标签、主题').fill('旧格式详情回归');await page.locator('[data-node-id="'+entry.id+'"] circle').click();await page.getByRole('heading',{name:'旧格式详情回归',exact:true}).waitFor();await page.getByText('旧记录缺少知识网络字段也能查看。').waitFor();await page.waitForTimeout(800);assert.deepEqual(errors,[]);assert.equal(await page.getByText('This page couldn’t load').count(),0);await page.screenshot({path:'outputs/legacy-detail-'+viewport.width+'.png',fullPage:true});
  await page.reload();await page.getByRole('heading',{name:'旧格式详情回归',exact:true}).waitFor();await page.getByText('旧记录缺少知识网络字段也能查看。').waitFor();await page.waitForTimeout(500);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: production build desktop/mobile graph click + detail reload; legacy response missing topic_paths/relations displays body without client error.');
}finally{await browser.close();if(entry){const r=await fetch(base+'/api/knowledge?id='+entry.id,{headers});const d=await r.json();await api({action:'update',id:entry.id,entry:{version:d.entry.version,status:'archived'}});}}
