// Local server, deterministic clock and mocked sources only; no publication helpers.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {visibleButtonSizes}=require('./browser-helpers.cjs');
const root=path.join(__dirname,'..'),out=process.env.QA_OUTPUT||root,now=Date.parse('2026-10-11T14:56:59Z');
const server=http.createServer((req,res)=>{
  const file=req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0].slice(1);
  if(!['index.html','styles.css','config.js','api.js','favorites.js','service-news.js','app.js'].includes(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(path.join(root,file)));
});
const message=(id='valid',content='港鐵東鐵綫服務受阻。',status='UPDATED',date='2026-10-11T22:55:00')=>`<message><INCIDENT_NUMBER>${id}</INCIDENT_NUMBER><CONTENT_CN>${content}</CONTENT_CN><INCIDENT_STATUS_EN>${status}</INCIDENT_STATUS_EN><ANNOUNCEMENT_DATE>${date}</ANNOUNCEMENT_DATE></message>`;
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const context=await browser.newContext({viewport:{width:393,height:852},timezoneId:'Asia/Hong_Kong'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  let mode='ready',newsBody='<list/>';
  await page.route('**/getSchedule.php?**',route=>{
    const url=new URL(route.request().url()),line=url.searchParams.get('line'),key=`${line}-${url.searchParams.get('sta')}`;
    if(mode==='alert')return route.fulfill({json:{status:0,message:'官方服務提示',url:'https://www.mtr.com.hk/service'}});
    const entry={curr_time:'2026-10-11 22:56:59',DOWN:[{time:'2026-10-11 23:02:00',dest:'ADM',plat:'2',timetype:'D'}],UP:[{time:'2026-10-11 23:00:53',dest:'LOW',plat:'1',timetype:'A'}]};
    if(mode==='missing')delete entry.DOWN;
    if(mode==='malformed')entry.DOWN={};
    if(mode==='invalid')entry.DOWN=[{time:'-',plat:'2'}];
    if(mode==='mixed')entry.DOWN.push({time:'-',plat:'3'});
    if(mode==='empty')entry.DOWN=[];
    return route.fulfill({json:{status:1,data:{[key]:entry}}});
  });
  await page.route('**/mtr-board.dllm-0bb.workers.dev/**',route=>route.fulfill({json:{}}));
  await page.route('**/special_news/trafficnews.xml',route=>route.fulfill({contentType:'application/xml',body:newsBody}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>activeRefresh===null&&serviceNews.kind==='ready');
  await page.evaluate(()=>stopRefreshTimer());
  const manage=async()=>{if(await page.locator('#board-menu').getAttribute('open')===null)await page.locator('#board-menu > summary').click();};
  const choose=async(line)=>{await manage();await page.locator(`.line-tab[data-line="${line}"]`).click();await page.waitForFunction(()=>activeRefresh===null);};
  const refresh=async()=>{await page.evaluate(async()=>{scheduleCache.clear();await refreshAll();});};
  const adm=page.locator('.station-card[data-line="EAL"][data-code="ADM"]');
  const checkDirection=async(view)=>{
    const target=view==='XFR'?adm.locator('.xfr-group').filter({has:page.locator('.xfr-header',{hasText:'東鐵'})}).first().locator('.xfr-col').first():adm.locator('[data-dir="DOWN"]');
    for(const kind of ['missing','malformed','invalid','mixed']){
      mode=kind;await refresh();assert.equal(await target.isVisible(),true,`${view} ${kind} must remain visible`);
      assert.match(await target.innerText(),/此方向.*資料未提供/);assert.match(await page.locator('#last-update').innerText(),/部分/);
      assert.equal(await target.locator('.train-row[data-target]').count(),kind==='mixed'?1:0);
    }
    mode='empty';await refresh();assert.doesNotMatch(await page.locator('#last-update').innerText(),/部分/);
    assert.doesNotMatch(await adm.textContent(),/資料未提供/);
    mode='ready';await refresh();
  };
  await checkDirection('EAL');await choose('XFR');await checkDirection('XFR');await choose('EAL');
  // A timer tick, source heartbeat or another station's result must retain focused links.
  mode='alert';await refresh();await adm.locator('.service-link').first().focus();
  const focus=await page.evaluate(()=>{
    const link=document.activeElement,card=link.closest('.station-card'),row=link.closest('.train-row');
    remaining=10;for(let i=0;i<3;i++)tickCountdown();
    renderSchedules();
    stationStates.set('EAL-EXC',{data:{status:0,message:'另一站更新'}});renderSchedules();
    return {focused:document.activeElement===link,rowRetained:card.contains(row),linkRetained:card.contains(link)};
  });assert.deepEqual(focus,{focused:true,rowRetained:true,linkRetained:true});
  mode='ready';await refresh();
  const incremental=await page.evaluate(()=>{
    const card=document.querySelector('.station-card[data-line="EAL"][data-code="ADM"]');
    const row=card.querySelector('.train-row[data-target]');window.retainedTrainRow=row;
    let addedElements=0;
    const observer=new MutationObserver(records=>{for(const record of records)addedElements+=[...record.addedNodes].filter(node=>node.nodeType===1).length;});
    observer.observe(card.querySelector('.card-body'),{childList:true,subtree:true});
    remaining=12;for(let i=0;i<5;i++)tickCountdown();
    // A fresh source timestamp with identical trains only changes the header.
    stationStates.get('EAL-ADM').data.data['EAL-ADM'].curr_time='2026-10-11 22:57:00';renderSchedules();
    for(const record of observer.takeRecords())addedElements+=[...record.addedNodes].filter(node=>node.nodeType===1).length;
    observer.disconnect();return {same:card.contains(row),addedElements};
  });assert.deepEqual(incremental,{same:true,addedElements:0});
  await page.clock.setFixedTime(new Date(now+60000));await page.evaluate(()=>{remaining=12;tickCountdown();});
  assert.equal(await page.evaluate(()=>retainedTrainRow.isConnected),true);
  assert.equal(await adm.locator('[data-dir="UP"] .train-mins').innerText(),'3 分');
  await page.clock.setFixedTime(new Date(now));
  for(const [direction,near,hint] of [['UP','將到','到站'],['DOWN','將開','開出']]){
    await page.evaluate(dir=>{const row=document.querySelector(`.station-card[data-line="EAL"][data-code="ADM"] [data-dir="${dir}"] .train-row[data-target]`);row.dataset.target=String(Date.now()+30000);updateRowCountdown(row);},direction);
    assert.equal(await adm.locator(`[data-dir="${direction}"] .train-mins`).innerText(),near);
    assert.equal(await adm.locator(`[data-dir="${direction}"] .train-hint`).innerText(),hint);
    assert.equal(await adm.locator(`[data-dir="${direction}"] .train-hint`).getAttribute('aria-label'),`預計${hint}`);
    await page.evaluate(dir=>{const row=document.querySelector(`.station-card[data-line="EAL"][data-code="ADM"] [data-dir="${dir}"] .train-row[data-target]`);row.dataset.target=String(Date.now()-1000);updateRowCountdown(row);},direction);
    assert.equal(await adm.locator(`[data-dir="${direction}"] .train-mins`).innerText(),'逾時');
  }
  await page.clock.setFixedTime(new Date(now+91002));await page.evaluate(()=>{remaining=12;tickCountdown();});
  assert.match(await adm.innerText(),/資料已過期/);await page.clock.setFixedTime(new Date(now));await refresh();
  // Hidden nested disclosure controls are excluded, while exposed controls are measured.
  const closedButtons=await page.evaluate(visibleButtonSizes);assert.ok(!closedButtons.some(button=>button.id==='favorite-save'));
  await page.locator('#favorites-editor summary').click();
  const openButtons=await page.evaluate(visibleButtonSizes);assert.ok(openButtons.some(button=>button.id==='favorite-save'));
  assert.ok(openButtons.every(button=>button.w>=44&&button.h>=44));
  await page.locator('#favorite-line').selectOption('EAL');await page.locator('#favorite-station').selectOption('FAN');await page.locator('#favorite-save').click();await page.waitForFunction(()=>activeRefresh===null);
  await manage();await page.locator('#favorites-editor summary').click();await page.locator('#favorite-line').selectOption('KTL');await page.locator('#favorite-station').selectOption('KOB');await page.locator('#favorite-save').click();await page.waitForFunction(()=>activeRefresh===null);
  await manage();await page.locator('#favorites-full').click();await page.waitForFunction(()=>activeRefresh===null);
  assert.equal(await page.evaluate(()=>activeLine),'KTL');await page.reload();await page.waitForFunction(()=>activeRefresh===null);await page.evaluate(()=>stopRefreshTimer());
  assert.equal(await page.evaluate(()=>activeLine),'KTL');assert.equal(await page.evaluate(()=>showingFavorites),false);
  await choose('XFR');await page.reload();await page.waitForFunction(()=>activeRefresh===null);await page.evaluate(()=>stopRefreshTimer());assert.equal(await page.evaluate(()=>activeLine),'XFR');
  // All Favorites follows the same collapse/focus behavior for pointer and keyboard input.
  for(const activation of ['click','keyboard']){
    await manage();const all=page.locator('#favorites-all');
    if(activation==='click')await all.click();else{await all.focus();await all.press('Enter');}
    await page.waitForFunction(()=>activeRefresh===null);
    assert.equal(await page.locator('#board-menu').getAttribute('open'),null);
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('#board-menu > summary')),true);
    assert.equal(await page.locator('.station-card:visible').count(),2);
    if(activation==='click')await choose('KTL');
  }
  await page.reload();await page.waitForFunction(()=>activeRefresh===null);await page.evaluate(()=>stopRefreshTimer());assert.equal(await page.evaluate(()=>showingFavorites),true);
  await page.locator('#service-panel > summary').click();
  const bad=message('bad','港鐵服務提示。','UNKNOWN');
  const unrelatedBad=message('bad-road','道路消息。','UPDATED','not-a-date');
  newsBody=`<list>${bad}${message()}${unrelatedBad}</list>`;await page.evaluate(()=>refreshServiceNews());
  assert.equal(await page.evaluate(()=>serviceNews.rejected),2);assert.equal(await page.locator('.service-notice').count(),1);
  assert.match(await page.locator('#service-summary').innerText(),/部分.*2\/3/);
  await page.locator('.service-notice details > summary').click();assert.match(await page.locator('#service-notices').innerText(),/東鐵綫服務受阻/);
  newsBody=`<list>${bad}</list>`;await page.evaluate(()=>refreshServiceNews());assert.equal(await page.locator('.service-notice').count(),0);assert.match(await page.locator('#service-summary').innerText(),/部分消息未能驗證/);assert.doesNotMatch(await page.locator('#service-summary').innerText(),/暫未見|來源暫未有/);
  newsBody='<list><message>';await page.evaluate(()=>refreshServiceNews());assert.equal(await page.evaluate(()=>serviceNews.kind),'parse-error');
  newsBody=`<list>${message()}</list>`;await page.evaluate(()=>refreshServiceNews());
  await page.locator('#service-panel > summary').click();
  await page.waitForFunction(()=>visibleCards.every(card=>getComputedStyle(card).opacity==='1'));
  const metrics=await page.evaluate(visibleButtonSizes);
  assert.ok(metrics.every(button=>button.w>=44&&button.h>=44));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,'qa-audited-favorites-393x852.png')});
  await choose('EAL');mode='mixed';await refresh();await page.waitForFunction(()=>visibleCards.every(card=>getComputedStyle(card).opacity==='1'));await page.screenshot({path:path.join(out,'qa-audited-partial-line-393x852.png')});
  await choose('XFR');await page.waitForFunction(()=>visibleCards.every(card=>getComputedStyle(card).opacity==='1'));await page.screenshot({path:path.join(out,'qa-audited-partial-transfer-393x852.png')});
  fs.writeFileSync(path.join(out,'audited-fixes-measurements.json'),JSON.stringify({viewport:{width:393,height:852},focus,incremental,visibleButtons:metrics,hiddenDisclosureButtonExcluded:true,horizontalOverflow:false,pageErrors:errors},null,2));
  assert.equal(errors.length,0,errors.join('\n'));await context.close();
  console.log('PASS eight-fix browser regressions: directions, ETA meaning, retained DOM/focus, visibility sizing, news isolation, menu focus, line/view reload, stale expiry');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();});
