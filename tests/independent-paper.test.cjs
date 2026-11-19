const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {IndependentPaperStore}=require('../scripts/independent-paper-store.cjs');
const {createIndependentPaperEngine,load}=require('../scripts/independent-paper-engine.cjs');
const base=Date.parse('2026-11-20T04:00:00Z'),at=n=>new Date(base+n*1000).toISOString();
function fixture(){let now=base;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'independent-paper-')),file=path.join(dir,'shadow.sqlite'),clock=()=>now,owner='test-owner';return {file,clock,owner,set(n){now=base+n*1000;},cleanup(){fs.rmSync(dir,{recursive:true,force:true});}};}
const q=(n,bid=99,ask=100)=>({id:'NSE:NIFTY26NOV25250CE',expiry:'2026-11-26',strike:25250,side:'CE',lotSize:65,at:at(n),bid,ask,bidSize:10000,askSize:10000});
const signal=(strategy='current',id='test')=>({strategyId:strategy==='current'?'nifty_paper_feed_v1':'nifty_hams_final_3m_v1',signalId:id,symbol:'NSE:NIFTY',timeframe:strategy==='current'?'1':'3',action:'BUY',metadata:{[strategy==='current'?'niftyPaper':'hamsFinalPaper']:{kind:'SIGNAL',high:25260,low:25250,closedAt:at(0)}}});
function boot(f){return createIndependentPaperEngine(f);}
test('fencing rejects a second local writer and expired owners, including stale renewal',()=>{
 const f=fixture(),s=new IndependentPaperStore(f.file,f.owner,{clock:f.clock}),a=s.claim('a');assert.throws(()=>s.claim('b'),/ALREADY_ACTIVE/);f.set(16);const b=s.claim('b');assert.throws(()=>s.renew(a),/FENCED/);assert.equal(b.epoch,a.epoch+1);s.close();f.cleanup();
});
test('state, consumed inbox and outbox roll back together on a reducer failure',()=>{
 const f=fixture(),s=new IndependentPaperStore(f.file,f.owner,{clock:f.clock});s.initialize('current',{rules:load('niftyLimitPaper').newLimitState(at(-60),1,true,false)});const token=s.claim('a');s.receive('current',{id:'one',receivedAt:at(0)});
 assert.throws(()=>s.advance('current',token,()=>{throw Error('simulated crash');},{signal:true}),/simulated/);assert.equal(s.health().pendingSignals,1);assert.equal(s.read('current').revision,0);assert.equal(s.pending().length,0);s.close();f.cleanup();
});
test('duplicate receipts retain original arrival, but conflicting content is rejected',()=>{
 const f=fixture(),s=new IndependentPaperStore(f.file,f.owner,{clock:f.clock});assert.equal(s.receive('current',{id:'one',receivedAt:at(0),high:10}).duplicate,false);assert.equal(s.receive('current',{id:'one',receivedAt:at(2),high:10}).duplicate,true);assert.throws(()=>s.receive('current',{id:'one',receivedAt:at(2),high:11}),/CONFLICT/);assert.equal(s.health().pendingSignals,1);s.close();f.cleanup();
});
test('both real strategy reducers can enter and exit while reporting is unavailable; replay reports once',async()=>{
 const f=fixture(),e=boot(f);for(const s of ['current','hams'])e.control(s,{enabled:true,id:'arm-'+s});
 f.set(-1);e.tick({at:at(-1),spot:25255,chain:[q(-1)]});f.set(0);e.tick({at:at(0),spot:25255,chain:[q(0)]});for(const s of ['current','hams'])e.signal(s,signal(s,s));
 f.set(1);e.tick({at:at(1),spot:25255,chain:[q(1)]});f.set(2);e.tick({at:at(2),spot:25261,chain:[q(2)]});for(const s of ['current','hams'])assert.equal(e.read(s).state.rules.position.entry,100);
 await assert.rejects(e.flush(async()=>{throw Error('Supabase down');}));f.set(3);e.tick({at:at(3),spot:25261,chain:[q(3,79,80)]});for(const s of ['current','hams']){const r=e.read(s).state.rules;assert.equal(r.position,null);assert.equal(r.trades.length,1);assert.equal(r.trades[0].reason,'PREMIUM_SL');assert.equal(r.nextLots,2);}
 const destination=new Map();await assert.rejects(e.flush(async rows=>{for(const r of rows)destination.set(r.id,r);throw Error('response lost');}));while(await e.flush(async rows=>{for(const r of rows)destination.set(r.id,r);return rows.map(r=>r.id);}));assert.equal([...destination.values()].filter(r=>r.kind==='ENTRY').length,2);assert.equal([...destination.values()].filter(r=>r.kind==='EXIT').length,2);assert.equal(e.health().pendingReports,0);e.close();f.cleanup();
});
test('an open position survives restart but no post-gap fill is invented',()=>{
 const f=fixture();let e=boot(f);e.control('current',{enabled:true,id:'arm'});e.tick({at:at(0),spot:25255,chain:[q(0)]});e.signal('current',signal());f.set(1);e.tick({at:at(1),spot:25255,chain:[q(1)]});f.set(2);e.tick({at:at(2),spot:25261,chain:[q(2)]});assert.ok(e.read('current').state.rules.position);e.close();f.set(4);e=boot(f);assert.equal(e.read('current').state.review.code,'WORKER_RESTART');e.tick({at:at(4),spot:25261,chain:[q(4,70,71)]});assert.ok(e.read('current').state.rules.position);assert.equal(e.read('current').state.rules.trades.length,0);assert.equal(e.read('current').state.sessionInterrupted,true);e.close();f.cleanup();
});
test('fresh index cannot hide an active-option price gap or create a verified exit after it',()=>{
 const f=fixture(),e=boot(f);e.control('current',{enabled:true,id:'arm'});e.tick({at:at(0),spot:25255,chain:[q(0)]});e.signal('current',signal());f.set(1);e.tick({at:at(1),spot:25255,chain:[q(1)]});f.set(2);e.tick({at:at(2),spot:25261,chain:[q(2)]});for(const n of [4,6,8]){f.set(n);e.tick({at:at(n),spot:25261,chain:[]});}assert.equal(e.read('current').state.review.code,'MARKET_PRICE_GAP');assert.equal(e.read('current').state.rules.trades.length,0);assert.throws(()=>e.control('current',{enabled:true,id:'rearm'}),/REVIEW/);e.close();f.cleanup();
});
test('store refuses production mode and another owner',()=>{const f=fixture();assert.throws(()=>new IndependentPaperStore(f.file,f.owner,{mode:'LIVE'}),/SHADOW/);const s=new IndependentPaperStore(f.file,f.owner);s.close();assert.throws(()=>new IndependentPaperStore(f.file,'other'),/IDENTITY/);f.cleanup();});
test('a hung reporting destination cannot block a stop-loss, local renewal or signal receipt',async()=>{
 const f=fixture(),e=boot(f);e.control('current',{enabled:true,id:'arm'});e.tick({at:at(0),spot:25255,chain:[q(0)]});e.signal('current',signal());f.set(1);e.tick({at:at(1),spot:25255,chain:[q(1)]});f.set(2);e.tick({at:at(2),spot:25261,chain:[q(2)]});let release;const reporting=e.flush(rows=>new Promise(resolve=>{release=()=>resolve(rows.map(r=>r.id));}));f.set(3);e.renew();e.tick({at:at(3),spot:25261,chain:[q(3,79,80)]});assert.equal(e.read('current').state.rules.trades.length,1);assert.equal(e.read('current').state.rules.position,null);release();await reporting;e.close();f.cleanup();
});
test('a completely silent feed creates a durable, queryable interruption, even without a reconnect message',()=>{
 const f=fixture(),e=boot(f);e.control('current',{enabled:true,id:'arm'});e.tick({at:at(0),spot:25255,chain:[q(0)]});e.signal('current',signal());f.set(1);e.tick({at:at(1),spot:25255,chain:[q(1)]});f.set(2);e.tick({at:at(2),spot:25261,chain:[q(2)]});f.set(8);e.watchdog();assert.equal(e.store.incidents()[0].code,'MARKET_PRICE_GAP');assert.equal(e.read('current').state.rules.trades.length,0);e.close();f.cleanup();
});
module.exports={fixture,signal,q,at};
