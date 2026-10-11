// Uses an already installed Playwright Core and Chromium; never downloads a browser.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.join(__dirname,'..');
const now=Date.parse('2026-10-11T14:56:59Z');
const server=http.createServer((req,res)=>{
  const name=req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0].slice(1);
  if(!['index.html','styles.css','config.js','api.js','favorites.js','service-news.js','app.js'].includes(name)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(path.join(root,name)));
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  for(const timezoneId of ['Asia/Hong_Kong','UTC','America/Los_Angeles']){
    const context=await browser.newContext({timezoneId,viewport:{width:393,height:852}});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date(now));
    let mode='ready',queued=[],held=[],requests=0;
    await page.route('**/getSchedule.php?**',async route=>{
      requests++;
      const url=new URL(route.request().url()),line=url.searchParams.get('line'),sta=url.searchParams.get('sta'),key=`${line}-${sta}`;
      if(mode==='hold' || mode==='oldline' && line==='EAL'){held.push(route);return;}
      let data={status:1,data:{[key]:{curr_time:'2026-10-11 22:56:59',UP:[{time:'2026-10-11 23:00:53',dest:line==='KTL'?'TIK':'LOW',plat:'1',seq:1,route:line==='EAL'?'RAC':'',timetype:'D'}],DOWN:[]}}};
      if(mode==='alert')data={status:0,message:'LOW station is suspended <script>alert(1)</script>'};
      if(mode==='absence')data={status:1,isdelay:'Y',data:{[key]:{curr_time:'-',sys_time:'-'}}};
      if(mode==='http'){await route.fulfill({status:429,body:'rate limited'});return;}
      await route.fulfill({json:data});
    });
    await page.route('**/mtr-board.dllm-0bb.workers.dev/**',route=>{queued.push(route);});
    await page.route('**/special_news/trafficnews.xml',route=>route.fulfill({contentType:'application/xml',body:'<list/>'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>activeRefresh===null && document.querySelector('.train-row[data-target] .train-mins')?.textContent==='4 分');
    const adm=page.locator('.station-card[data-line="EAL"][data-code="ADM"]');
    assert.match(await adm.innerText(),/經馬場/);assert.match(await adm.locator('.train-row').last().getAttribute('title'),/開出 2026-10-11 23:00:53/);
    assert.equal(await page.locator('#last-update').innerText(),'22:56:59');
    assert.equal(queued.length,2);
    assert.equal(await page.evaluate(async()=>{try{await fetchJson(`${CP_PROXY_BASE}?target=test`,20);return "unexpected success";}catch(error){return error.name;}}), 'AbortError'); // Hung queues have not blocked all sixteen stations.
    const geometry=await page.evaluate(()=>({columns:getComputedStyle(board).gridTemplateColumns.split(' ').length,font:getComputedStyle(document.querySelector('.train-row')).fontSize,buttons:[...document.querySelectorAll('button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})),overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.equal(geometry.columns,1);assert.equal(geometry.font,'14px');assert.ok(geometry.buttons.every(b=>b.w>=44&&b.h>=44));assert.equal(geometry.overflow,false);
    assert.equal(await page.locator('.line-tab[data-line="EAL"]').getAttribute('aria-pressed'),'true');
    await page.locator('.toggle-btn[data-count="2"]').click();assert.equal(await page.locator('.toggle-btn[data-count="2"]').getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{const row=document.querySelector('.train-row[data-target]');row.dataset.target=String(Date.now()-9000);updateRowCountdown(row);});
    assert.equal(await adm.locator('.train-mins').last().innerText(),'已開');
    await page.evaluate(()=>{renderSchedules()});assert.equal(await adm.locator('.train-mins').last().innerText(),'4 分');
    await page.clock.setFixedTime(new Date('2026-10-11T15:59:30Z'));
    await page.evaluate(()=>{stationStates.set('EAL-ADM',{data:{status:1,data:{'EAL-ADM':{curr_time:'2026-10-11 23:59:30',UP:[{time:'2026-10-12 00:01:00',dest:'LOW',plat:'1'}],DOWN:[]}}}});renderSchedules();});
    assert.equal(await adm.locator('.train-mins').last().innerText(),'2 分');
    assert.match(await adm.locator('.train-row').last().getAttribute('title'),/2026-10-12 00:01:00/);
    await page.clock.setFixedTime(new Date(now));
    for(const [state,expected] of [['alert','LOW station is suspended'],['absence','暫未能提供列車資料'],['http','更新失敗']]){
      mode=state;await page.evaluate(()=>scheduleCache.clear());await page.locator('#refresh').click();
      await page.waitForFunction(()=>activeRefresh===null);assert.match(await adm.innerText(),new RegExp(expected));assert.equal(await page.locator('#last-update').innerText(),'資料未更新');
    }
    mode='oldline';await page.evaluate(()=>scheduleCache.clear());await page.locator('#refresh').click();await page.waitForFunction(()=>activeRefresh!==null);
    const before=requests;await page.locator('#refresh').click();
    await page.evaluate(()=>{for(let i=0;i<20;i++)tickCountdown();});
    assert.equal(requests,before); // no second same-view batch
    await page.locator('.line-tab[data-line="KTL"]').click();
    await page.waitForFunction(()=>activeRefresh===null && activeLine==='KTL');
    assert.match(await page.locator('.station-card[data-line="KTL"][data-code="KOT"]').innerText(),/調景嶺/);
    assert.equal(await page.locator('#cp-board').isVisible(),false);
    for(const route of [...held,...queued])await route.fulfill({json:{status:0,message:'old response'}}).catch(()=>{});
    assert.equal(await page.locator('.line-tab[data-line="KTL"]').getAttribute('aria-pressed'),'true');
    mode='ready';
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.evaluate(()=>refreshTimer),null);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>activeRefresh===null && refreshTimer!==null);
    await page.evaluate(()=>{stationStates.set('KTL-KOT',{data:{status:1,data:{'KTL-KOT':{curr_time:'2026-10-11 22:00:00',UP:[],DOWN:[]}}}});renderSchedules();});
    assert.match(await page.locator('.station-card[data-line="KTL"][data-code="KOT"]').innerText(),/資料已過期/);
    assert.equal(errors.length,0,errors.join('\n'));
    await page.waitForFunction(()=>visibleCards.every(card=>getComputedStyle(card).opacity==='1'));
    await page.screenshot({path:path.join(process.env.QA_OUTPUT || root,`qa-${timezoneId.replaceAll('/','-')}.png`),fullPage:true});
    await page.locator('.line-tab[data-line="XFR"]').click();
    await page.waitForFunction(()=>activeRefresh===null && activeLine==='XFR');
    assert.ok(await page.locator('.station-card[data-line="EAL"][data-code="ADM"] .xfr-group').count()===4);
    await page.waitForFunction(()=>visibleCards.every(card=>getComputedStyle(card).opacity==='1'));
    await page.screenshot({path:path.join(process.env.QA_OUTPUT || root,`qa-transfer-${timezoneId.replaceAll('/','-')}.png`),fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:path.join(process.env.QA_OUTPUT || root,`qa-desktop-${timezoneId.replaceAll('/','-')}.png`),fullPage:true});
    await context.close();console.log(`PASS browser ${timezoneId}: ETA/header, hung queues, errors, replacement, overlap/cancel, stale, mobile accessibility`);
  }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();});
