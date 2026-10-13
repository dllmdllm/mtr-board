const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.join(__dirname,'..'),now=Date.parse('2026-10-11T14:56:59Z');
const server=http.createServer((req,res)=>{
 const file=req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0].slice(1);
 if(!['index.html','styles.css','config.js','api.js','favorites.js','service-news.js','app.js'].includes(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));
});
const xml=(content='港鐵東鐵綫大圍至九龍塘段服務受阻。',status='UPDATED',date='2026-10-11T22:55:00')=>`<list><message><INCIDENT_NUMBER>IN-26-TEST</INCIDENT_NUMBER><ID>123</ID><INCIDENT_HEADING_CN>鐵路服務消息</INCIDENT_HEADING_CN><ANNOUNCEMENT_DATE>${date}</ANNOUNCEMENT_DATE><INCIDENT_STATUS_EN>${status}</INCIDENT_STATUS_EN><CONTENT_CN>${content}</CONTENT_CN><LOCATION_CN>大圍至九龍塘</LOCATION_CN><DIRECTION_CN>原文所列方向</DIRECTION_CN></message></list>`;
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const url=`http://127.0.0.1:${server.address().port}/`;
 for(const timezoneId of ['Asia/Hong_Kong','UTC','America/Los_Angeles']){
  const context=await browser.newContext({timezoneId,viewport:{width:393,height:852}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(now));
  let mode='ready',held=[],newsBody=xml(),newsHTTP=200,newsRequests=[];
  const schedule=(route,override)=>{
   const url=new URL(route.request().url()),line=url.searchParams.get('line'),sta=url.searchParams.get('sta'),key=`${line}-${sta}`;
   return {status:1,data:{[key]:{curr_time:'2026-10-11 22:56:59',DOWN:[{time:'2026-10-11 23:00:53',dest:override || 'ADM',plat:'4'},{time:'2026-10-11 23:03:53',dest:override || 'HUH',plat:'2'}],UP:[{time:'2026-10-11 23:04:53',dest:override || 'LOW',plat:'1'}]}}};
  };
  await page.route('**/getSchedule.php?**',route=>{if(mode==='hold'){held.push(route);return;}if(mode==='http')return route.fulfill({status:503,body:'test'});const data=schedule(route);const entry=Object.values(data.data)[0];if(mode==='empty')entry.DOWN=[];if(mode==='missing')delete entry.DOWN;if(mode==='invalid')entry.DOWN=[{time:'-',plat:'4'}];if(mode==='absence'){delete entry.UP;delete entry.DOWN;entry.curr_time='-';}return route.fulfill({json:data});});
  await page.route('**/mtr-board.dllm-0bb.workers.dev/**',route=>route.fulfill({json:{LWS:{arrQueue:0,depQueue:0}}}));
  await page.route('**/special_news/trafficnews.xml',route=>{newsRequests.push({url:route.request().url(),method:route.request().method(),body:route.request().postData()});return route.fulfill({status:newsHTTP,contentType:'application/xml',body:newsBody});});
  const manage=async()=>{if(await page.locator('#board-menu').getAttribute('open')===null)await page.locator('#board-menu > summary').click();};
  await page.goto(url);await page.waitForFunction(()=>activeRefresh===null && serviceNews.kind==='ready');
  assert.match(await page.locator('#favorites-message').innerText(),/尚未儲存/);assert.equal(await page.locator('.favorite-shortcut').count(),0);assert.equal(await page.locator('#favorite-save').isDisabled(),true);
  const save=async(code)=>{await manage();await page.locator('#favorites-editor summary').click();await page.locator('#favorite-line').selectOption('EAL');await page.locator('#favorite-station').selectOption(code);await page.locator('#favorite-save').click();await page.waitForFunction(()=>activeRefresh===null);};
  await save('FAN');assert.equal(await page.locator('#favorite-direction').count(),0);
  assert.equal(await page.locator('.station-card:visible').count(),1);
  const fan=page.locator('.station-card[data-line="EAL"][data-code="FAN"]');
  assert.match(await fan.innerText(),/往金鐘/);assert.equal(await fan.locator('[data-dir="UP"]').isVisible(),true);assert.equal(await fan.locator('[data-dir="DOWN"]').isVisible(),true);assert.match(await fan.innerText(),/月台 4/);assert.match(await fan.innerText(),/月台 2/);assert.match(await fan.innerText(),/月台 1/);assert.match(await fan.innerText(),/金鐘/);
  assert.match(await page.locator('#service-summary').innerText(),/涉及收藏路線/);
  await page.waitForFunction(()=>visibleCards.every(card=>getComputedStyle(card).opacity==='1'));
  await page.screenshot({path:path.join(process.env.QA_OUTPUT || root,`qa-both-directions-${timezoneId.replaceAll('/','-')}.png`)});
  await page.setViewportSize({width:320,height:800});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await fan.locator('[data-dir="UP"]').isVisible(),true);assert.equal(await fan.locator('[data-dir="DOWN"]').isVisible(),true);
  await page.screenshot({path:path.join(process.env.QA_OUTPUT || root,`qa-both-directions-320-${timezoneId.replaceAll('/','-')}.png`)});
  await page.setViewportSize({width:393,height:852});
  await save('FAN');await save('FAN');assert.equal(await page.locator('.favorite-shortcut').count(),1);await manage();assert.match(await page.locator('#favorites-message').innerText(),/已儲存/);
  await page.reload();await page.waitForFunction(()=>activeRefresh===null);
  assert.equal(await page.locator('.station-card:visible').count(),1);assert.equal(await fan.locator('[data-dir="DOWN"]').isVisible(),true);assert.match(await fan.innerText(),/羅湖/);
  await manage();const chosen=page.locator('.favorite-shortcut button[aria-pressed="true"]');assert.equal(await chosen.innerText(),'粉嶺 · 東鐵');
  await page.evaluate(()=>scheduleCache.clear());mode='hold';
  await page.locator('#refresh').click();await page.waitForFunction(()=>activeRefresh!==null);
  mode='ready';await save('FOT');
  for(const route of held)await route.fulfill({json:schedule(route,'TIK')}).catch(()=>{});
  assert.equal(await page.locator('.station-card:visible').count(),2);const fot=page.locator('.station-card[data-code="FOT"][data-line="EAL"]');assert.match(await fot.innerText(),/火炭/);assert.doesNotMatch(await fot.innerText(),/調景嶺/);assert.equal(await fot.locator('[data-dir="DOWN"]').isVisible(),true);
  for(const [state,label] of [['empty','暫無班次'],['missing','此方向資料未提供'],['invalid','此方向資料未提供'],['http','更新失敗'],['absence','暫未能提供列車資料']]){mode=state;await page.evaluate(()=>scheduleCache.clear());await page.locator('#refresh').click();await page.waitForFunction(()=>activeRefresh===null);assert.equal(await fot.locator('[data-dir="DOWN"]').isVisible(),true);assert.equal(await fot.locator('[data-dir="UP"]').isVisible(),true);assert.match(await fot.locator('[data-dir="DOWN"]').innerText(),new RegExp(label));if(state==='missing'||state==='invalid')assert.match(await page.locator('#last-update').innerText(),/部分/);if(state==='empty'||state==='missing'||state==='invalid')assert.match(await fot.locator('[data-dir="UP"]').innerText(),/羅湖/);}
  mode='ready';await page.evaluate(()=>scheduleCache.clear());await page.locator('#refresh').click();await page.waitForFunction(()=>activeRefresh===null);
  await page.locator('#service-panel summary').first().click();
  assert.match(await page.locator('.service-disclosure').innerText(),/非 AI/);
  const refreshNews=async()=>{await page.evaluate(()=>refreshServiceNews());};
  const detailOnly=xml('大圍至九龍塘服務提示。').replace('鐵路服務消息','特別交通消息').replace('</INCIDENT_HEADING_CN>','</INCIDENT_HEADING_CN><INCIDENT_DETAIL_CN>港鐵東鐵綫</INCIDENT_DETAIL_CN>');
  assert.equal(await page.evaluate(source=>parseTrafficNews(source).notices[0].lines.includes('EAL'),detailOnly),true);
  const south=xml('MTR South Island Line service arrangements.');
  const southLines=await page.evaluate(source=>parseTrafficNews(source).notices[0].lines,south);assert.ok(southLines.includes('SIL'));assert.ok(!southLines.includes('ISL'));
  newsBody=xml('港鐵服務有變，未有列出路線。');await refreshNews();assert.match(await page.locator('#service-notices').innerText(),/未能判斷/);
  newsBody=xml('港鐵東鐵綫服務提示。','UPDATED','2024-01-01T10:00:00');await refreshNews();assert.equal(await page.evaluate(()=>serviceNews.kind),'ready');assert.match(await page.locator('#service-notices').innerText(),/2024-01-01 10:00:00/); // publication time is not a feed heartbeat
  newsBody=xml('&lt;img src=x onerror="window.injected=1"&gt;港鐵東鐵綫服務提示。');await refreshNews();assert.equal(await page.locator('#service-notices img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
  newsBody=xml('港鐵東鐵綫事件已完結。','CLOSED');await refreshNews();assert.match(await page.locator('#service-notices').innerText(),/已完結/);assert.match(await page.locator('#service-summary').innerText(),/暫未見未完結/);
  newsBody='<list/>';await refreshNews();assert.match(await page.locator('#service-summary').innerText(),/來源暫未有/);
  newsBody=xml('粉嶺站附近道路交通恢復。').replace('鐵路服務消息','道路消息');await refreshNews();assert.equal(await page.evaluate(()=>serviceNews.notices.length),0);assert.match(await page.locator('#service-summary').innerText(),/暫未見/);
  newsBody='<list><message>';await refreshNews();assert.equal(await page.evaluate(()=>serviceNews.kind),'parse-error');
  newsHTTP=503;await refreshNews();assert.equal(await page.evaluate(()=>serviceNews.kind),'fetch-error');assert.match(await page.locator('#service-notices').innerText(),/最近成功檢查/);
  newsHTTP=200;newsBody=xml();await refreshNews();await page.evaluate(()=>{serviceNews.checkedAt-=360001;renderServiceNews();});assert.match(await page.locator('#service-summary').innerText(),/檢查已過期/);
  assert.ok(newsRequests.every(r=>r.url==='https://www.td.gov.hk/tc/special_news/trafficnews.xml' && r.method==='GET' && r.body===null));
  await manage();await page.locator('.favorite-shortcut button[aria-label^="移除 火炭"]').click();await page.waitForFunction(()=>activeRefresh===null);assert.equal(await page.locator('.station-card:visible').count(),1);assert.equal(await page.locator('#favorites-all').getAttribute('aria-pressed'),'true');
  await manage();await page.locator('.line-tab[data-line="KTL"]').click();await page.waitForFunction(()=>activeRefresh===null);assert.equal(await page.locator('.station-card[data-line="KTL"]:visible').count(),17);
  await manage();while(await page.locator('.favorite-shortcut').count())await page.locator('.favorite-shortcut button[aria-label^="移除"]').first().click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem(FAVORITES_KEY)));assert.equal(stored.items.length,0);assert.equal(stored.selectedId,null);
  assert.equal(errors.length,0,errors.join('\n'));
  await page.screenshot({path:path.join(process.env.QA_OUTPUT || root,`qa-features-${timezoneId.replaceAll('/','-')}.png`)});await context.close();
  console.log(`PASS favorites/news ${timezoneId}: save/remove/duplicate/reload, both-directions/partial-data/races/full-board, news attribution/status/privacy/expiry`);
 }
 {
  const context=await browser.newContext({viewport:{width:393,height:852}}),page=await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(()=>{if(!localStorage.getItem('mtrBoardFavoritesV1'))localStorage.setItem('mtrBoardFavoritesV1',JSON.stringify({version:1,items:[{line:'EAL',code:'FAN',direction:'DOWN'},{line:'EAL',code:'FAN',direction:'UP'},{line:'EAL',code:'FOT',direction:'UP'}],selectedId:'EAL-FAN-UP'}));});
  await page.route('**/getSchedule.php?**',route=>{const u=new URL(route.request().url()),key=`${u.searchParams.get('line')}-${u.searchParams.get('sta')}`;return route.fulfill({json:{status:1,data:{[key]:{curr_time:'2026-10-11 22:56:59',DOWN:[],UP:[{time:'2026-10-11 23:04:53',dest:'LOW',plat:'3'}]}}}});});
  await page.route('**/mtr-board.dllm-0bb.workers.dev/**',route=>route.fulfill({json:{}}));await page.route('**/special_news/trafficnews.xml',route=>route.fulfill({body:'<list/>'}));
  await page.goto(url);await page.waitForFunction(()=>activeRefresh===null);
  assert.equal(await page.locator('.favorite-shortcut').count(),2);assert.equal(await page.locator('.favorite-shortcut button[aria-pressed="true"]').textContent(),'粉嶺 · 東鐵');
  assert.equal(await page.locator('.station-card[data-code="FAN"] [data-dir="DOWN"]').isVisible(),true);assert.match(await page.locator('.station-card[data-code="FAN"]').innerText(),/暫無班次/);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem(FAVORITES_KEY)));assert.equal(stored.version,2);assert.equal(stored.items.length,2);assert.equal(stored.selectedId,'EAL-FAN');assert.ok(stored.items.every(item=>!('direction' in item)));
  await page.reload();await page.waitForFunction(()=>activeRefresh===null);assert.equal(await page.locator('.favorite-shortcut').count(),2);await context.close();console.log('PASS legacy migration and reload');
 }
 for(const failure of ['corrupt','unavailable']){
  const context=await browser.newContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(kind=>{if(kind==='corrupt')localStorage.setItem('mtrBoardFavoritesV1','broken');else Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});},failure);
  await page.route('**/getSchedule.php?**',route=>route.fulfill({json:{status:0,message:'test'}}));await page.route('**/mtr-board.dllm-0bb.workers.dev/**',route=>route.fulfill({json:{}}));await page.route('**/special_news/trafficnews.xml',route=>route.fulfill({body:'<list/>'}));
  await page.goto(url);await page.waitForFunction(()=>activeRefresh===null);assert.match(await page.locator('#favorites-message').innerText(),/未能讀取/);assert.ok(await page.locator('.station-card:visible').count()>0);assert.equal(errors.length,0);await context.close();console.log(`PASS storage ${failure}`);
 }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();});
