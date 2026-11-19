const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const file=path.resolve(__dirname,'../app/lib/algo/'+name+'.ts'),m=new Module(file,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const {applyReconstruction,signReconstruction,reconstructionId,reconstructionHash}=load('paperReconciliation'),{newLimitState,optionCosts}=load('niftyLimitPaper');
const owner='fixture-owner',key='fixture-private-key',at='2026-11-19T11:00:00.000Z';
function fixture(strategy='current'){
 const s=newLimitState('2026-11-17T04:00:00Z',strategy==='current'?1:3,true,true),entry=strategy==='current'?157.3:157.05,quantity=strategy==='current'?195:65;
 s.balance=strategy==='current'?995880.34:1019779.94;s.lossCycle={loss:strategy==='current'?6589.30:606.93,net:strategy==='current'?-4119.66:19779.94,count:5};
 s.position={signalId:'fixture-'+strategy,openedAt:'2026-11-19T08:50:00.000Z',entry,stop:entry-20,target:entry+100,quantity,lots:quantity/65,contract:{id:'NSE:NIFTY26NOV25350CE',side:'CE'},ruleVersion:2,sizing:{version:2}};
 s.decisions=[{id:s.position.signalId,receivedAt:s.position.openedAt,status:'ENTERED'}];
 const incident={signalId:s.position.signalId,at:'2026-11-19T09:02:30.600Z',reason:'Original evidence remains'};
 const payload={version:1,owner,strategy,id:reconstructionId(owner,strategy,s.position),position:structuredClone(s.position),incidentAt:incident.at,approvedAt:at,source:'FYERS_1M_OHLC',fillVerified:false,reason:'TIME_EXIT',exit:213.35,windowStart:'2026-11-19T09:20:00.000Z',windowEnd:'2026-11-19T09:21:00.000Z',net:strategy==='current'?10781.16:3578.51,evidenceHash:'a'.repeat(64)};
 payload.evidence={candles:[{at:payload.windowStart,open:payload.exit}],oppositeSignals:[]};payload.evidenceHash=reconstructionHash(payload.evidence);
 return {s,incidents:[incident],command:signReconstruction(payload,key),strategy};
}
test('approved Current and HAMS estimates include charges, adjust recovery, preserve evidence and survive replay',()=>{
 for(const strategy of ['current','hams']){
 const f=fixture(strategy),original=JSON.stringify(f.s),r=applyReconstruction(f.s,f.incidents,f.command,key,owner,strategy,at);
 assert.equal(r.applied,true);assert.equal(JSON.stringify(f.s),original);assert.equal(r.state.position,null);assert.equal(r.state.enabled,false);assert.equal(r.state.nextLots,1);assert.equal(r.state.lossCycle.loss,0);
 assert.equal(r.state.balance,strategy==='current'?1006661.50:1023358.45);assert.equal(r.state.lossCycle.net,strategy==='current'?6661.50:23358.45);
 const t=r.state.trades.at(-1);assert.equal(t.reason,'TIME_EXIT');assert.equal(t.pnl,f.command.payload.net);assert.equal(t.reconstruction.fillVerified,false);assert.equal(t.costs.total,optionCosts(t.entry,t.exit,t.quantity).total);
 assert.equal(r.incidents[0].reason,'Original evidence remains');assert.equal(r.incidents[0].status,'CLOSED_RECONSTRUCTED_ESTIMATE');
 const saved=JSON.parse(JSON.stringify(r));const replay=applyReconstruction(saved.state,saved.incidents,f.command,key,owner,strategy,at);
 assert.equal(replay.applied,false);assert.equal(replay.state.trades.length,1);assert.equal(replay.state.balance,r.state.balance);
 }
});
test('tampering, cross-owner, cross-strategy and changed positions cannot change balances',()=>{
 const f=fixture();const bad=structuredClone(f.command);bad.payload.exit++;
 for(const [command,k,o,strategy] of [[bad,key,owner,'current'],[f.command,'wrong',owner,'current'],[f.command,key,'other','current'],[f.command,key,owner,'hams']])assert.throws(()=>applyReconstruction(f.s,f.incidents,command,k,o,strategy,at));
 const changed=structuredClone(f.s);changed.position.quantity=65;assert.throws(()=>applyReconstruction(changed,f.incidents,f.command,key,owner,'current',at),/POSITION_CONFLICT/);
 assert.equal(f.s.trades.length,0);
});
test('a signed command still requires matching unresolved incident, exact net and session cutoff',()=>{
 for(const alter of [p=>p.net++,p=>p.windowStart='2026-11-19T09:19:00Z',p=>p.fillVerified=true]){
 const f=fixture();alter(f.command.payload);f.command=signReconstruction(f.command.payload,key);assert.throws(()=>applyReconstruction(f.s,f.incidents,f.command,key,owner,'current',at));
 }
 const f=fixture();f.incidents[0].acknowledgedAt=at;assert.throws(()=>applyReconstruction(f.s,f.incidents,f.command,key,owner,'current',at));
});
test('JSONB key order does not invalidate approval signatures',()=>{
 const f=fixture(),reverse=o=>o&&typeof o==='object'?(Array.isArray(o)?o.map(reverse):Object.fromEntries(Object.entries(o).reverse().map(([k,v])=>[k,reverse(v)]))):o;
 assert.equal(applyReconstruction(f.s,f.incidents,reverse(f.command),key,owner,'current',at).applied,true);
});
test('Current projection retains explicit reconstructed quality',()=>{
 const f=fixture(),r=applyReconstruction(f.s,f.incidents,f.command,key,owner,'current',at);
 const {buildNiftyLimitPaper}=load('niftyLimitAdapter');
 const b=buildNiftyLimitPaper([],at,{rulesV2:r.state,trades:[]});
 assert.equal(b.trades[0].reconstruction.fillVerified,false);assert.equal(b.checkpoint.rulesV2.trades.length,1);
});

