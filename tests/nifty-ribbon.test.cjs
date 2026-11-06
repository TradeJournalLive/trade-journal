const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const f=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const ribbon=load('ribbonSignal'),hams=load('hamsSignal');
test('Ribbon signal is paper-only, validates three-minute candle and strips other execution metadata',()=>{
 const input={strategyId:'nifty_ribbon_test_3m_v1',symbol:'NSE:NIFTY',timeframe:'3',action:'BUY',automation:{enabled:true,mode:'LIVE'},metadata:{ribbonPaper:{kind:'SIGNAL',barOpen:'2026-11-06T04:00:00Z',high:'22550',low:'22500'},niftyPaper:{kind:'SIGNAL'},btcPaper:{kind:'SIGNAL'}}};
 const result=ribbon.isolateRibbonSignal(input);
 assert.deepEqual(result.automation,{enabled:false,mode:'PAPER',underlying:'NIFTY'});
 assert.equal(result.metadata.ribbonPaper.closedAt,'2026-11-06T04:03:00.000Z');
 assert.equal(result.metadata.niftyPaper,undefined);assert.equal(result.metadata.btcPaper,undefined);
 assert.equal(hams.isolateHamsSignal(result),result);
 assert.throws(()=>ribbon.isolateRibbonSignal({...input,timeframe:'1'}));
 assert.throws(()=>ribbon.isolateRibbonSignal({...input,strategyId:'nifty_hams_final_3m_v1'}));
 const old={strategyId:'nifty_hams_final_3m_v1',metadata:{hamsFinalPaper:{kind:'SIGNAL'}}};assert.equal(ribbon.isolateRibbonSignal(old),old);
});
test('Ribbon and HAMS share identical limit rules but independent capital, positions and sizing',()=>{
 const a=load('ribbonLimitAdapter'),b=load('hamsLimitAdapter'),p=load('ribbonPaper');
 const at=n=>new Date(Date.parse('2026-11-06T04:00:00Z')+n*1000).toISOString();
 const base=a.initializeHamsLimits({...p.emptyHamsState(),enabled:true},at(-60));
 assert.equal(base.balance,1000000);assert.equal(base.rulesV2.interval,3);
 let x=structuredClone(base),y=structuredClone(base);
 const quote=(t)=>({id:'CE',side:'CE',expiry:'2026-11-09',strike:22500,lotSize:65,at:at(t),bid:99,ask:100,bidSize:20000,askSize:20000});
 for(let n=-1;n<=3;n++){const tick={at:at(n),spot:22500,chain:[quote(n)]};x=a.markHamsLimit(x,tick);y=b.markHamsLimit(y,tick);}
 const signal={id:'ribbon-test',action:'BUY',closedAt:at(0),receivedAt:at(3),high:22520,low:22470,interval:3};
 x=a.receiveHamsLimit(x,signal,at(3));y=b.receiveHamsLimit(y,signal,at(3));
 x=a.markHamsLimit(x,{at:at(4),spot:22521,chain:[quote(4)]});y=b.markHamsLimit(y,{at:at(4),spot:22521,chain:[quote(4)]});
 assert.ok(x.position);assert.deepEqual(x.position,y.position);assert.equal(x.position.entryLimit,104);assert.equal(x.position.stop,80);assert.equal(x.position.target,200);
 assert.equal(base.position,null);assert.equal(base.nextLots,1);
 assert.ok(x.seen.every(id=>id.startsWith('nifty_ribbon_test_3m_v1:')));
});
test('Ribbon worker storage and control route cannot overwrite existing workers',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../scripts/nifty-ribbon-worker.cjs'),'utf8');
 assert.match(source,/STRATEGY = '__nifty_ribbon_worker__'/);assert.match(source,/path.join\(root, 'nifty-ribbon'\)/);
 assert.doesNotMatch(source,/__hams_final_worker__|__hams_final_control__|__paper_control__/);
 const emergency=fs.readFileSync(path.resolve(__dirname,'../app/api/algo/ribbon-emergency/route.ts'),'utf8');
 assert.match(emergency,/__nifty_ribbon_control__/);assert.doesNotMatch(emergency,/__hams_final_control__|__paper_control__/);
});
