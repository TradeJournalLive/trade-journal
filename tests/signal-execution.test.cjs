const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),Module=require('node:module'),path=require('node:path');
function load(rows, fail=false){
  const queries=[];
  const db={from(){const filters=[];let range;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);queries.push([k,v]);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},range(a,b){range=[a,b];return q},then(resolve,reject){return Promise.resolve(fail?{error:{}}:{data:rows.filter(r=>filters.every(f=>f(r))).slice(range?.[0]??0,range?range[1]+1:undefined)}).then(resolve,reject)}};return q}};
  const file=path.resolve(__dirname,'../app/lib/algo/signalExecution.ts'),m=new Module(file,module);
  m.require=id=>id==='./signalStore'?{getServerSupabase:()=>db,hashWebhookSecret:s=>s}:require(id);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
  return {...m.exports,queries};
}
const event=(id,symbol='NSE:NIFTY',metadata={})=>({receivedAt:'2026-10-22T03:46:06Z',signal:{id,symbol,metadata}});
test('execution reasons isolate owners and markets, and preserve recorded BTC partial fills',async()=>{
  const f=load([
    {secret_hash:'a',strategy_id:'__nifty_paper_decision__',raw_payload:{decision:{id:'same',status:'INVALID_SIGNAL_CANDLE',reason:'Range exceeds 35',decidedAt:'2026-10-22T03:46:10Z'}}},
    {secret_hash:'a',strategy_id:'__btc_delta_decision__',raw_payload:{decision:{id:'same',status:'PARTIALLY_FILLED',reason:'Filled 0.4 BTC; remainder canceled',decidedAt:'2026-10-22T03:46:10Z'}}},
    {secret_hash:'b',strategy_id:'__nifty_paper_decision__',raw_payload:{decision:{id:'private',status:'ENTERED',reason:'not yours',decidedAt:'2026-10-22T03:46:10Z'}}}
  ]);
  const result=await f.addSignalExecutions('a',[event('same'),event('same','DELTAIN:BTCUSD.P'),event('private')]);
  assert.equal(result[0].execution.status,'INVALID_SIGNAL_CANDLE');
  assert.equal(result[1].execution.status,'PARTIALLY_FILLED');
  assert.equal(result[2].execution.source,'Not recorded');
  assert.ok(f.queries.every(([k,v])=>k!=='secret_hash'||v==='a'));
});
test('legacy range checks are labelled inferred, while missing history never becomes a claimed rejection',async()=>{
  const f=load([]),result=await f.addSignalExecutions('a',[event('range','NSE:NIFTY',{niftyPaper:{high:22697.55,low:22564.9}}),event('unknown')]);
  assert.equal(result[0].execution.source,'Rule check');assert.match(result[0].execution.reason,/132.65/);
  assert.equal(result[1].execution.status,'NOT_RECORDED');
});
test('actual entry evidence wins over a stale waiting decision; storage failure is not a false success',async()=>{
  const f=load([
    {secret_hash:'a',strategy_id:'__nifty_paper_trade__',raw_payload:{trade:{signalId:'entry',openedAt:'2026-10-22T04:00:00Z',entry:130,lots:5,contract:{id:'contract'}}}},
    {secret_hash:'a',strategy_id:'__nifty_paper_decision__',raw_payload:{decision:{id:'entry',status:'WAITING',reason:'waiting',decidedAt:'2026-10-22T03:46:10Z'}}}
  ]);
  assert.equal((await f.addSignalExecutions('a',[event('entry')]))[0].execution.status,'ENTERED');
  await assert.rejects(load([],true).addSignalExecutions('a',[event('entry')]),/unavailable/);
});
test('Signals defaults to a visible Trade Reasons tab with execution evidence',()=>{
  const file=path.resolve(__dirname,'../app/dashboard/SignalExecutionTable.tsx'),m=new Module(file,module);
  m.require=id=>id==='../lib/algo/reportDates'?{istDay:()=> '2026-10-22',istTime:()=> '09:16:00',signalTime:e=>e.signal.timestamp}:require(id);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const html=renderToStaticMarkup(React.createElement(m.exports.default,{events:[{...event('range'),signal:{...event('range').signal,timestamp:'2026-10-22T03:46:00Z',action:'SELL',status:'VALIDATED'},decision:{reasons:['received']},execution:{status:'CANDLE_RANGE_EXCEEDED',reason:'132.65 points exceeds 35',source:'Rule check'}}]}));
  assert.match(html,/aria-selected="true"[^>]*>Trade Reasons/);
  assert.match(html,/132.65 points exceeds 35/);assert.match(html,/Rule check/);assert.match(html,/Webhook Delivery/);
});
