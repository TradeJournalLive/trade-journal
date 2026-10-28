const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const filename = require('node:path').resolve(__dirname, '../app/lib/algo/hamsFinalPaper.ts');
const copy = new Module(filename, module);
copy._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { emptyHamsState, setHamsEnabled, enterHams, markHams, nextHamsLots, hamsContract, hamsFinalRules } = copy.exports;
const at = '2026-10-28T04:30:01.000Z';
const signal = { strategyId: hamsFinalRules.strategyId, id: 'buy-1', action: 'BUY', symbol: 'NSE:NIFTY', timeframe: '3', closedAt: '2026-10-28T04:30:00.000Z', receivedAt: at };
const chain = [22500,22550,22600].flatMap(strike => ['CE','PE'].map(side => ({ id: `${strike}${side}`, expiry:'2026-10-29', strike, side, lotSize:65, at, bid:99, ask:100, bidSize:10000, askSize:10000 })));
const data = { at, spot:22575, chain, candle:{contractId:'22550CE', openedAt:'2026-10-28T04:27:00.000Z', closedAt:signal.closedAt, low:90} };
const initial = () => setHamsEnabled(emptyHamsState(), true);
test('isolated namespace, disabled by default and no mutation of input', () => {
  assert.equal(emptyHamsState().enabled,false);
  const before=initial(); enterHams(before,signal,data); assert.equal(before.position,null);
  assert.deepEqual(enterHams(before,{...signal,strategyId:'nifty_breakout_options_v1'},data),before);
});
test('1 ITM selects strict in-money side between strikes and at exact strike',()=>{
  assert.equal(hamsContract(22575,'CE',chain,at).strike,22550);
  assert.equal(hamsContract(22575,'PE',chain,at).strike,22600);
  assert.equal(hamsContract(22550,'CE',chain,at).strike,22500);
});
test('close entry uses actual ask; premium low minus five; target three times risk',()=>{
  const s=enterHams(initial(),signal,data);
  assert.equal(s.position.entry,100); assert.equal(s.position.stop,85); assert.equal(s.position.target,145);
  assert.equal(s.position.quantity,65); assert.equal(s.balance,500000);
  assert.deepEqual(enterHams(s,signal,data),s);
});
test('SL doubles capped at 20; target resets; other exits preserve size',()=>{
  let n=1; for(const expected of [2,4,8,16,20,20]) { n=nextHamsLots(n,'SL');assert.equal(n,expected); }
  assert.equal(nextHamsLots(20,'TARGET_3R'),1);
  assert.equal(nextHamsLots(8,'OPPOSITE_SIGNAL'),8);assert.equal(nextHamsLots(8,'TIME_EXIT'),8);
});
test('insufficient capital, stale quote, wrong candle and old signal cannot fill',()=>{
  assert.equal(enterHams({...initial(),balance:6000},signal,data).status,'INSUFFICIENT_VIRTUAL_CAPITAL');
  assert.equal(enterHams(initial(),signal,{...data,candle:{...data.candle,contractId:'22600PE'}}).status,'MISSING_MATCHING_PREMIUM_CANDLE');
  assert.equal(enterHams(initial(),signal,{...data,at:'2026-10-28T04:33:00.000Z'}).status,'MISSED_SIGNAL_CLOSE');
  assert.equal(enterHams(initial(),signal,{...data,chain:chain.map(q=>({...q,at:'2026-10-28T04:29:00.000Z'}))}).position,null);
});
test('verified exit updates balance once and restart keeps progression',()=>{
  const s=enterHams(initial(),signal,data), q={...s.position.contract,at:'2026-10-28T04:31:00.000Z',bid:84,ask:85};
  const closed=markHams(s,q,q.at);
  assert.equal(closed.balance,500000-16*65);assert.equal(closed.nextLots,2);assert.equal(closed.trades.length,1);
  const restored=JSON.parse(JSON.stringify(closed));assert.deepEqual(markHams(restored,q,q.at),closed);
});
test('opposite signal requests exit even with entries switched off',()=>{
  const s=setHamsEnabled(enterHams(initial(),signal,data),false);
  const opposite=enterHams(s,{...signal,id:'sell-2',action:'SELL'},data);
  assert.equal(opposite.pendingExit,'OPPOSITE_SIGNAL');
  const q={...s.position.contract,at:'2026-10-28T04:31:00.000Z'};
  const closed=markHams(opposite,q,q.at);assert.equal(closed.trades[0].reason,'OPPOSITE_SIGNAL');assert.equal(closed.nextLots,1);
});
test('PE purchase uses its own premium candle and profit also resets to one lot',()=>{
  const sell={...signal,id:'sell-1',action:'SELL'};
  const s=enterHams({...initial(),nextLots:4},sell,{...data,candle:{...data.candle,contractId:'22600PE'}});
  assert.equal(s.position.contract.side,'PE');assert.equal(s.position.stop,85);
  const q={...s.position.contract,at:'2026-10-28T04:31:00.000Z',bid:145,ask:146};
  const closed=markHams(s,q,q.at);assert.equal(closed.nextLots,1);assert.equal(closed.balance,500000+45*260);
});
test('stale nearest expiry does not silently roll into next expiry',()=>{
  const later=chain.map(q=>({...q,expiry:'2026-11-05'}));
  assert.equal(hamsContract(data.spot,'CE',[...chain.map(q=>({...q,at:'2026-10-28T04:29:00.000Z'})),...later],at),null);
});
test('invalid timestamps, wrong interval, insufficient depth and invalid stop cannot enter',()=>{
  assert.equal(enterHams(initial(),signal,{...data,at:'bad'}).status,'INVALID_SIGNAL');
  assert.equal(enterHams(initial(),{...signal,timeframe:'1'},data).status,'INVALID_SIGNAL');
  assert.equal(enterHams(initial(),signal,{...data,chain:chain.map(q=>({...q,askSize:1}))}).status,'INSUFFICIENT_OBSERVED_ASK_DEPTH');
  assert.equal(enterHams(initial(),signal,{...data,candle:{...data.candle,low:110}}).status,'INVALID_PREMIUM_STOP');
});
test('14:55 time exit remains active when entries disabled; no fabricated stale exit',()=>{
  const s=setHamsEnabled(enterHams(initial(),signal,data),false);
  const q={...s.position.contract,at:'2026-10-28T09:25:00.000Z'};
  assert.equal(markHams(s,q,'2026-10-28T09:26:00.000Z').position.signalId,signal.id);
  const closed=markHams(s,q,q.at);assert.equal(closed.trades[0].reason,'TIME_EXIT');
  assert.equal(closed.nextLots,1);
});
test('multi-level entry consumes actual quantities inside four points, never invented size',()=>{
  const depth={depthAt:at,askSize:30,asks:[{price:100,quantity:30},{price:102,quantity:35}]};
  const s=enterHams(initial(),signal,{...data,chain:chain.map(q=>({...q,...depth}))});
  assert.equal(s.position.entry,(3000+3570)/65);assert.equal(s.position.quantity,65);
  assert.equal(enterHams(initial(),signal,{...data,chain:chain.map(q=>({...q,...depth,asks:[{price:100,quantity:30},{price:105,quantity:35}]}))}).position,null);
});
test('triggered stop remains pending through temporary insufficient exit depth',()=>{
  const s=enterHams(initial(),signal,data);
  const q={...s.position.contract,at:'2026-10-28T04:31:00.000Z',bid:84,ask:85,bidSize:1};
  const waiting=markHams(s,q,q.at);assert.equal(waiting.pendingExit,'SL');assert.ok(waiting.position);
  const recovered={...q,at:'2026-10-28T04:31:01.000Z',bid:90,ask:91,bidSize:100};
  const closed=markHams(waiting,recovered,recovered.at);assert.equal(closed.trades[0].reason,'SL');assert.equal(closed.nextLots,2);
});
