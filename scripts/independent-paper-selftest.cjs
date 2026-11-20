const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createIndependentPaperEngine}=require('./independent-paper-engine.cjs');

// Synthetic prices and a fake reporting destination, in a disposable, separate DB.
async function independentSelftest(directory){
  const dir=fs.mkdtempSync(path.join(directory,'selftest-')),file=path.join(dir,'simulation.sqlite');
  const base=Date.parse('2026-11-20T04:00:00Z');let now=base,engine;
  const at=n=>new Date(base+n*1000).toISOString();
  const quote=(n,bid=99,ask=100)=>({id:'NSE:NIFTY26NOV25250CE',expiry:'2026-11-26',strike:25250,side:'CE',lotSize:65,at:at(n),bid,ask,bidSize:10000,askSize:10000});
  const signal=strategy=>({strategyId:strategy==='current'?'nifty_paper_feed_v1':'nifty_hams_final_3m_v1',signalId:'isolated-'+strategy,symbol:'NSE:NIFTY',timeframe:strategy==='current'?'1':'3',action:'BUY',metadata:{[strategy==='current'?'niftyPaper':'hamsFinalPaper']:{kind:'SIGNAL',high:25260,low:25250,closedAt:at(0)}}});
  const boot=()=>createIndependentPaperEngine({file,owner:'isolated-selftest',clock:()=>now});
  const tick=(n,spot=25255,bid=99,ask=100)=>{now=base+n*1000;engine.tick({at:at(n),spot,chain:[quote(n,bid,ask)]});};
  try{
    engine=boot();for(const s of ['current','hams'])engine.control(s,{enabled:true,id:'arm-'+s});
    tick(0);for(const s of ['current','hams']){engine.signal(s,signal(s));assert.equal(engine.signal(s,signal(s)).duplicate,true);}
    tick(1);tick(2,25261);
    for(const s of ['current','hams'])assert.ok(engine.read(s).state.rules.position);
    await assert.rejects(engine.flush(async()=>{throw Error('SIMULATED_REPORTING_OUTAGE');}));
    tick(3,25261,79,80);
    for(const s of ['current','hams']){assert.equal(engine.read(s).state.rules.position,null);assert.equal(engine.read(s).state.rules.trades.length,1);}
    const destination=new Map();
    await assert.rejects(engine.flush(async rows=>{for(const row of rows)destination.set(row.id,row);throw Error('SIMULATED_LOST_ACK');}));
    while(await engine.flush(async rows=>{for(const row of rows)destination.set(row.id,row);return rows.map(row=>row.id);}));
    assert.equal([...destination.values()].filter(r=>r.kind==='ENTRY').length,2);
    assert.equal([...destination.values()].filter(r=>r.kind==='EXIT').length,2);
    engine.close();engine=boot();
    for(const s of ['current','hams'])assert.equal(engine.read(s).state.rules.trades.length,1);
    assert.equal(engine.health().pendingReports,0);
    // Open a second position and verify restart preserves it without inventing an exit.
    tick(4);for(const s of ['current','hams'])engine.signal(s,{...signal(s),signalId:'restart-'+s,metadata:{[s==='current'?'niftyPaper':'hamsFinalPaper']:{kind:'SIGNAL',high:25260,low:25250,closedAt:at(4)}}});
    tick(5);tick(6,25261);
    for(const s of ['current','hams'])assert.ok(engine.read(s).state.rules.position);
    engine.close();now=base+7000;engine=boot();tick(7,25261,70,71);
    for(const s of ['current','hams']){assert.ok(engine.read(s).state.rules.position);assert.equal(engine.read(s).state.review.code,'WORKER_RESTART');assert.equal(engine.read(s).state.rules.trades.length,1);}
    return {status:'PASSED',synthetic:true,externalRequests:0,checks:['both_strategy_entries','reporting_outage_exit','duplicate_receipt','lost_ack_idempotency','closed_trade_restart','open_position_restart_review']};
  }finally{engine?.close();fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={independentSelftest};
