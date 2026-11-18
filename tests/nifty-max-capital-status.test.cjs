const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(name) {
  const file=path.join(__dirname,'../app/lib/algo',name+'.ts'), compiled=new Module(file,module);
  compiled.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);
  compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
  return compiled.exports;
}
const { niftyPaperStatus }=load('niftyLossCycle');
const at=n=>new Date(Date.parse('2026-11-17T04:00:00Z')+n*60000).toISOString();
const trade=(n,capital,pnl,reason='PREMIUM_SL')=>({openedAt:at(n),closedAt:at(n+1),entry:capital,quantity:1,pnl,reason});
const state=trades=>({enabled:true,status:'WAITING_FOR_SIGNAL',nextLots:4,balance:1000000,pendingExit:null,mark:null,position:null,trades,lossCycle:{loss:9000,net:-9000,count:3}});
const history=()=>[trade(0,60000,-20000),trade(1,80000,10000,'TIME_EXIT'),trade(2,100000,-30000),trade(3,200000,60000,'PREMIUM_TARGET'),trade(4,220000,-5000)];
test('compact status restores the original peak formula and never offsets it with non-target profits',()=>{
  const s=state(history()),before=structuredClone(s);
  assert.equal(niftyPaperStatus(s,'READY',null).maxCapitalRequired,250000);
  assert.deepEqual(s,before);
});
test('fresh-panel capital excludes pre-reset history while retaining previous fresh-session peaks across days',()=>{
  const old={...trade(-2000,9000000,-500000),openedAt:'2026-11-16T04:00:00Z',closedAt:'2026-11-16T04:01:00Z'};
  const s=state([old,...history(),{...trade(0,1000,10,'PREMIUM_TARGET'),openedAt:'2026-11-18T04:00:00Z',closedAt:'2026-11-18T04:01:00Z'}]);
  assert.equal(niftyPaperStatus(s,'READY',null).maxCapitalRequired,250000);
});
test('an open entry counts premium capital plus prior net losses without summing old entry premiums',()=>{
  const s=state([trade(0,100*65,-1337.52)]);
  s.position={openedAt:at(2),contract:{id:'CE'},entry:150,quantity:65,lots:1,stop:130,target:250};
  const d=niftyPaperStatus(s,'READY',null);
  assert.equal(d.maxCapitalRequired,11087.52);assert.equal(d.cash,990250);assert.equal(d.lots,4);
});
test('known commitment retained in recovery evidence cannot disappear from the peak or create an assumed exit',()=>{
  const s=state(history()),before=structuredClone(s);
  const entry={openedAt:at(6),entry:300000,quantity:1};
  const d=niftyPaperStatus(s,'RECOVERY_REVIEW_REQUIRED',null,true,s.trades,[entry]);
  assert.equal(d.maxCapitalRequired,305000);assert.equal(d.reviewRequired,true);assert.deepEqual(s,before);
});
test('missing or empty history is unavailable rather than a fabricated zero, and strategy reports are independent',()=>{
  assert.equal(niftyPaperStatus(state([]),'READY',null).maxCapitalRequired,null);
  const missing=state(undefined);assert.equal(niftyPaperStatus(missing,'READY',null).maxCapitalRequired,null);
  assert.equal(niftyPaperStatus(state([trade(0,5000,-10)]),'READY',null).maxCapitalRequired,5000);
  assert.equal(niftyPaperStatus(state([trade(0,12000,-10)]),'READY',null).maxCapitalRequired,12000);
});
