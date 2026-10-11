const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function runtime(overrides = {}) {
  const empty = {classList:{toggle(){}},addEventListener(){}};
  const context = vm.createContext({console, Date, AbortController, setTimeout, clearTimeout,
    navigator:{onLine:true},localStorage:{getItem(){return null}},
    document:{getElementById(){return empty},querySelectorAll(){return []},querySelector(){return null},addEventListener(){}},
    ...overrides});
  for (const file of ['config.js','api.js','app.js']) {
    let code = fs.readFileSync(path.join(root,file),'utf8');
    if (file === 'app.js') code = code.replace(/renderBoard\(\);\s*refreshAll\(\);\s*startRefreshTimer\(\);\s*$/, '');
    vm.runInContext(code,context);
  }
  return context;
}
const now = Date.parse('2026-10-11T14:56:59Z');
const fixture = {status:1,data:{'EAL-ADM':{curr_time:'2026-10-11 22:56:59',UP:[{time:'2026-10-11 23:00:53',dest:'LOW',plat:'1',seq:1}],DOWN:[]}}};
test('full Hong Kong timestamps, rollover and header are independent of device timezone',()=>{
  const c=runtime();
  for(const [time,utc] of [['2026-10-11 23:00:53','2026-10-11T15:00:53Z'],['2026-10-12 00:01:00','2026-10-11T16:01:00Z'],['2027-01-01 00:00:00','2026-12-31T16:00:00Z'],['2024-02-29 00:00:00','2024-02-28T16:00:00Z']]) assert.equal(c.parseTimeToMs(time),Date.parse(utc));
  assert.equal(c.hongKongTime(now),'22:56:59');
  for(const value of [null,undefined,'-',42,'2026-02-30 12:00:00','2026-10-11','garbage']) assert.ok(Number.isNaN(c.parseTimeToMs(value)));
});
test('official alert, absence, empty-success, delay, stale and transport failure remain distinct',()=>{
  const c=runtime();
  const classify=(data,error)=>c.classifySchedule(data,'EAL-ADM',error,now);
  assert.equal(classify(fixture).kind,'ready');
  assert.equal(classify(fixture).up.length,1); // valid/ttnt are documented dummy fields.
  assert.equal(classify({status:0,message:'LOW station is suspended'}).text,'LOW station is suspended');
  assert.equal(classify({status:1,isdelay:'Y',data:{'EAL-ADM':{curr_time:'-',sys_time:'-'}}}).kind,'unavailable');
  const empty=structuredClone(fixture);empty.data['EAL-ADM'].UP=[];
  assert.equal(classify(empty).kind,'ready');
  const delay=structuredClone(fixture);delay.isdelay='Y';assert.equal(classify(delay).text,'列車延誤');
  const stale=structuredClone(fixture);stale.data['EAL-ADM'].curr_time='2026-10-11 22:00:00';assert.equal(classify(stale).kind,'stale');
  assert.equal(classify(null,new Error('HTTP 429')).kind,'error');
  c.navigator.onLine=false;assert.match(classify(null,new Error()).text,/離線/);
});
test('replacement ETA immediately replaces departed countdown and agrees with row target',()=>{
  const c=runtime();
  const label={classList:{toggle(){}}};
  const row={dataset:{target:String(Date.now()-9000),key:'ADM-UP-0'},querySelector:s=>s==='.train-mins'?label:null};
  c.updateRowCountdown(row);assert.equal(label.textContent,'已開');
  row.dataset.target=String(Date.now()+240000);c.updateRowCountdown(row);assert.equal(label.textContent,'4 分');
  row.dataset.target=String(Date.now()+600000);c.updateRowCountdown(row);assert.equal(label.textContent,'10 分');
});
test('timeout remains active through response-body parsing and external cancellation works',async()=>{
  let timer,cleared=false;
  const c=runtime({setTimeout(fn){timer=fn;return 1},clearTimeout(){cleared=true},fetch:async(url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))})});
  const pending=c.fetchJson('test');await new Promise(setImmediate);timer();await assert.rejects(pending,/aborted/);assert.equal(cleared,true);
  const controller=new AbortController();const next=c.fetchJson('test',8000,controller.signal);await new Promise(setImmediate);controller.abort();await assert.rejects(next,/aborted/);
});
test('station concurrency is bounded and every result can make progress',async()=>{
  const c=runtime();let active=0,max=0,done=0;
  const result=await c.runLimited(Array.from({length:27},(_,i)=>i),async item=>{active++;max=Math.max(max,active);await Promise.resolve();active--;done++;return item;});
  assert.equal(max,6);assert.equal(done,27);assert.equal(result.length,27);
});
