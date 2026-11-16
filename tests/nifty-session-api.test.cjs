const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const cutoff = '2026-11-16T18:30:00.000Z';
function endpoint({ loggedIn = true, rows = [] } = {}) {
  const filename = path.resolve(__dirname, '../app/api/algo/paper-session/route.ts');
  const m = new Module(filename, module), calls = [];
  const db = { from(table) {
    assert.equal(table, 'tradingview_signal_events');
    const q = Object.fromEntries(['select','eq','like','gte','order'].map(name=>[name,(...args)=>{calls.push([name,...args]);return q;}]));
    q.limit = n => { calls.push(['limit',n]); return { data: rows }; };
    q.maybeSingle = () => ({ data: { dashboard:{workerStatus:'READY'},received_at:new Date().toISOString() } });
    return q;
  } };
  m.require = id => {
    if (id === 'next/server') return { NextResponse: Response };
    if (id.endsWith('/connection')) return { connectionSecret: () => loggedIn ? 'fixture' : null };
    if (id.endsWith('/signalStore')) return { getServerSupabase: () => db, hashWebhookSecret: s => `owner:${s}` };
    if (id.endsWith('/niftyLossCycle')) return { niftyFreshSessionAt: cutoff };
    return require(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
  return { get: params => m.exports.GET(new Request(`https://panel.invalid/api/algo/paper-session?${params}`)), calls };
}

test('status only fetches the selected owned snapshot, without loading history', async () => {
  const x=endpoint(); const r=await x.get('strategy=current');
  assert.equal((await r.json()).workerOnline,true);
  assert.match(r.headers.get('cache-control'),/no-store/);
  assert.deepEqual(x.calls,[['select','received_at,dashboard:raw_payload->dashboard'],['eq','secret_hash','owner:fixture'],['eq','strategy_id','__nifty_paper_worker__'],['eq','signal_id','state']]);
  const anon=endpoint({loggedIn:false}); assert.equal((await anon.get('strategy=hams')).status,401); assert.deepEqual(anon.calls,[]);
});

test('HAMS history is bounded, account-scoped and hides legacy entries',async()=>{
  const fresh={signalId:'fresh',openedAt:cutoff,closedAt:cutoff,contract:{id:'NIFTY'},lots:1,entry:100,exit:80,costs:{total:50},pnl:-1350,sizing:{version:2},reason:'PREMIUM_SL'};
  const x=endpoint({rows:[{trade:fresh},{trade:{...fresh,signalId:'legacy',sizing:{version:1}}},{trade:{...fresh,signalId:'before',openedAt:'2026-11-16T18:29:59.999Z'}}]});
  const { trades }=await (await x.get('strategy=hams&view=trades')).json();
  assert.deepEqual(trades.map(t=>t.id),['fresh']); assert.equal(trades[0].charges,50);
  assert.ok(x.calls.some(c=>c[0]==='gte'&&c[2]===cutoff)); assert.ok(x.calls.some(c=>c[0]==='limit'&&c[1]===50));
});
