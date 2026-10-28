/* Independent PAPER worker: market-data endpoints only; never imports an order API. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), Module = require('node:module');
const ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false);
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('csv-parse/sync');
const { fyersDataSocket } = require('fyers-api-v3');
const { readDepth } = require('./nifty-depth.cjs');
const file = path.resolve(__dirname, '../app/lib/algo/hamsFinalPaper.ts'), mod = new Module(file, module);
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { emptyHamsState, setHamsEnabled, enterHams, markHams, hamsContract, hamsFinalRules } = mod.exports;
const TABLE = 'tradingview_signal_events', STRATEGY = '__hams_final_worker__', INDEX = 'NSE:NIFTY50-INDEX';
const root = path.resolve('.paper-worker'), directory = path.join(root, 'hams-final');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const env = process.env, hash = s => crypto.createHash('sha256').update(s).digest('hex');
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !config.webhookSecret) throw new Error('MISSING_PRIVATE_CONFIGURATION');
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) } });
const owner = hash(config.webhookSecret), workerId = crypto.randomUUID(), checkpoint = path.join(directory, 'checkpoint.json');
const now = () => new Date().toISOString();
const day = at => new Date(Date.parse(at) + 330*60000).toISOString().slice(0,10);
let state = emptyHamsState(), decisions = [], pending = null, connection, socket, master = [], spot = null;
let lease, ack = 0, status = 'STARTING', feedAt = null, mark = null, stopped = false, busy = false, publishing = false, pollAfter;
const quotes = new Map(), depths = new Map(), processed = new Set();
function audit(type, value) { fs.appendFileSync(path.join(directory, `${day(now())}.jsonl`), JSON.stringify({ at: now(), type, value })+'\n', { mode: 0o600 }); }
function save() {
  fs.writeFileSync(checkpoint+'.tmp', JSON.stringify({ owner, state, decisions, pending, savedAt: now(), pollAfter }), { mode: 0o600 });
  fs.renameSync(checkpoint+'.tmp', checkpoint);
}
function owned() { return !stopped && Date.now()-ack < 10000; }
function decide(signal, result) {
  const value = { id: signal.id, receivedAt: signal.receivedAt, status: result };
  const i = decisions.findIndex(d => d.id === signal.id);
  if (i < 0) decisions.push(value); else decisions[i] = value;
  audit('DECISION', value); save();
}
function decrypt(sealed, prefix) {
  const b = Buffer.from(sealed, 'base64url'), key = crypto.createHash('sha256').update(`${prefix}:${env.ALGO_CONNECTION_ENCRYPTION_KEY || env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0,12)); cipher.setAuthTag(b.subarray(12,28));
  return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8');
}
async function one(strategy, secret, id) {
  const r = await db.from(TABLE).select('raw_payload').eq('strategy_id', strategy).eq('secret_hash', secret).eq('signal_id', id).maybeSingle();
  if (r.error) throw new Error('ACCOUNT_STORAGE_UNAVAILABLE'); return r.data?.raw_payload;
}
async function credentials() {
  // Follow the immutable webhook ownership claim, never choose another account by app ID.
  const key = crypto.createHash('sha256').update(`account:${env.ALGO_CONNECTION_ENCRYPTION_KEY || env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
  const internal = v => crypto.createHmac('sha256', key).update(v).digest('hex');
  const claim = await one('__account_connections__', internal(`claim:webhook:${config.webhookSecret}`), 'webhook');
  if (!claim?.user) throw new Error('LINK_WEBHOOK_TO_ACCOUNT_FIRST');
  const account = internal(`account:${claim.user}`);
  const webhook = await one('__account_connections__', account, 'webhook');
  if (!webhook?.sealed || decrypt(webhook.sealed, 'account') !== config.webhookSecret) throw new Error('WEBHOOK_OWNER_MISMATCH');
  const binding = await one('__account_connections__', account, 'fyers');
  if (!binding?.sealed) throw new Error('CONNECT_FYERS_FOR_THIS_ACCOUNT');
  const device = decrypt(binding.sealed, 'account');
  const fyers = await one('__fyers_connection__', hash(device), 'credentials');
  const value = fyers?.sealed ? JSON.parse(decrypt(fyers.sealed, 'fyers')) : null;
  if (!value?.accessToken || !value.appId) throw new Error('FYERS_LOGIN_REQUIRED');
  return value;
}
async function api(endpoint) {
  if (!/^(data\/history\?|data\/options-chain-v3\?|data\/quotes\?)/.test(endpoint)) throw new Error('READ_ONLY_ENDPOINT_REQUIRED');
  const response = await fetch(`https://api-t1.fyers.in/${endpoint}`, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, signal: AbortSignal.timeout(10000) });
  const body = await response.json(); if (!response.ok || body.s !== 'ok') throw new Error('FYERS_DATA_UNAVAILABLE'); return body;
}
function row(id, at, raw, strategy = STRATEGY) {
  return { secret_hash: owner, strategy_id: strategy, signal_id: id, symbol: 'NIFTY', action: 'EXIT', received_at: at, signal_timestamp: at, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: {}, decision: {}, raw_payload: raw };
}
async function publish() {
  if (publishing || stopped) return;
  publishing = true;
  try {
    const at = now(), snapshot = { workerId, state: structuredClone(state), decisions: structuredClone(decisions), pending, feedAt, mark, workerStatus: status };
    const r = await db.from(TABLE).update(row('state',at,snapshot)).eq('secret_hash',owner).eq('strategy_id',STRATEGY).eq('signal_id','state').eq('received_at',lease).select('id');
    if (r.error || r.data?.length !== 1) throw new Error('LEASE_OR_STORAGE_LOST');
    lease = at; ack = Date.parse(at); save();
  } finally { publishing = false; }
}
function contractQuotes(at) {
  return master.map(c => {
    const q = quotes.get(c.id), d = depths.get(c.id);
    if (!q) return { ...c, at:'',bid:0,ask:0,bidSize:0,askSize:0 };
    const sync = d && Date.parse(at)-Date.parse(q.at) <= 5000 && Date.parse(at)-Date.parse(d.depthAt) <= 5000 && d.asks[0].price === q.ask && d.bids[0].price === q.bid;
    return { ...c, ...q, ...(sync ? { asks:d.asks,bids:d.bids,depthAt:d.depthAt } : {}) };
  });
}
function onMessage(message) {
  try {
    for (const r of Array.isArray(message) ? message : [message]) {
      if (!r?.symbol) continue;
      const at = now();
      if (r.type === 'dp') { const d = readDepth(r,at); if (d) depths.set(r.symbol,d); }
      else {
        const t = Number(r.exch_feed_time)*1000;
        if (!Number.isFinite(t) || Date.now()-t < 0 || Date.now()-t > 5000) continue;
        if (r.symbol === INDEX && Number(r.ltp)>0) spot = { price:Number(r.ltp),at:t };
        else if (Number(r.bid_price)>0 && Number(r.ask_price)>=Number(r.bid_price)) quotes.set(r.symbol,{ at:new Date(t).toISOString(),bid:Number(r.bid_price),ask:Number(r.ask_price),bidSize:Number(r.bid_size),askSize:Number(r.ask_size) });
      }
      if (spot && Date.now()-spot.at <= 5000) feedAt = new Date(spot.at).toISOString();
      if (!owned()) continue;
      if (state.position && r.symbol === state.position.contract.id) {
        const q = contractQuotes(at).find(c => c.id === r.symbol);
        if (q) {
          const before = state.trades.length;
          // Receipt-time depth can update within an exchange second; persist both sources.
          if (q.depthAt) q.at = new Date(Math.max(Date.parse(q.at),Date.parse(q.depthAt))).toISOString();
          state = markHams(state,q,at); mark = q.bid;
          if (state.trades.length !== before) { audit('TRADE',state.trades.at(-1)); save(); }
        }
      }
      tryEntry();
    }
  } catch { status = 'PROCESSING_ERROR'; stopped = true; }
}
function tryEntry() {
  if (!pending?.candle || !owned() || state.position) return;
  const at = now();
  if (!spot || Date.now()-spot.at > 5000) return;
  const chain = contractQuotes(at), selected = chain.find(q => q.id === pending.candle.contractId);
  if (!selected || !selected.at || Date.now()-Date.parse(selected.at)>5000) return;
  pending.initialAsk ??= selected.ask; pending.attemptAt ??= Date.now();
  if (selected.ask > pending.initialAsk+4) { decide(pending.signal,'ENTRY_PRICE_EXCEEDED_INITIAL_ASK_PLUS_4'); pending=null; save(); return; }
  const bounded = chain.map(q=>q.id===selected.id && q.asks ? {...q,asks:q.asks.filter(l=>l.price<=pending.initialAsk+4)} : q);
  const next = enterHams(state,pending.signal,{at,spot:pending.spot,chain:bounded,candle:pending.candle});
  if (next.status === 'INSUFFICIENT_OBSERVED_ASK_DEPTH' && Date.now()-pending.attemptAt<1500) return;
  state=next; decide(pending.signal,state.status); pending=null; save();
}
async function prepare(signal) {
  if (pending) { decide(pending.signal,'SUPERSEDED'); pending=null; }
  if (state.seen.includes(`${signal.strategyId}:${signal.id}`)) return;
  if (state.position) {
    state=enterHams(state,signal,{at:now(),spot:spot?.price || 1,chain:[],candle:null});
    decide(signal,state.status);
    // Opposite alert closes the current position; no unconfirmed delayed reversal.
    return;
  }
  if (!state.enabled) { decide(signal,'DISABLED'); return; }
  if (!owned() || !spot || Date.now()-spot.at>5000) { decide(signal,'FRESH_INDEX_DATA_REQUIRED'); return; }
  const at=now(), chain=contractQuotes(at), selected=hamsContract(spot.price,signal.action==='BUY'?'CE':'PE',chain,at);
  if (!selected) { decide(signal,'MISSING_FRESH_1_ITM_CONTRACT'); return; }
  const savedSpot=spot.price;
  decide(signal,'LOADING_COMPLETED_3M_OPTION_CANDLE');
  const end=Math.floor(Date.parse(signal.closedAt)/1000);
  const result=await api(`data/history?symbol=${encodeURIComponent(selected.id)}&resolution=3&date_format=0&range_from=${end-3600}&range_to=${end}&cont_flag=1`);
  const candle=(result.candles||[]).find(c=>Number(c[0])*1000+180000===Date.parse(signal.closedAt));
  if (!candle || !(Number(candle[3])>0)) { decide(signal,'MATCHING_PREMIUM_CANDLE_UNAVAILABLE'); return; }
  pending={signal,spot:savedSpot,candle:{contractId:selected.id,openedAt:new Date(Number(candle[0])*1000).toISOString(),closedAt:signal.closedAt,low:Number(candle[3])}};
  save(); tryEntry();
}
async function poll() {
  if (busy || !owned()) return; busy=true;
  try {
    const r=await db.from(TABLE).select('id,received_at,strategy_id,signal,raw_payload').eq('secret_hash',owner).in('strategy_id',[hamsFinalRules.strategyId,'__hams_final_control__']).gte('received_at',pollAfter).order('received_at').order('id').limit(1000);
    if (r.error || r.data?.length===1000) throw new Error('SIGNAL_STORAGE_UNAVAILABLE');
    for(const value of r.data||[]) {
      if(processed.has(value.id)) continue;
      if(value.strategy_id==='__hams_final_control__') {
        if(typeof value.raw_payload?.enabled==='boolean') { state=setHamsEnabled(state,value.raw_payload.enabled); if(!state.enabled)pending=null; save(); }
      } else {
        const s=value.signal, candle=s?.metadata?.hamsFinalPaper;
        if(candle?.kind==='SIGNAL' && s.timeframe==='3' && ['BUY','SELL'].includes(s.action)) {
          const signal={ strategyId:s.strategyId,id:s.id,action:s.action,symbol:s.symbol,timeframe:s.timeframe,closedAt:candle.closedAt,receivedAt:value.received_at };
          try { await prepare(signal); } catch { decide(signal,'FYERS_CANDLE_REQUEST_FAILED'); }
        }
      }
      processed.add(value.id);
    }
    if(r.data?.length) pollAfter=new Date(Date.parse(r.data.at(-1).received_at)-60000).toISOString();
  } finally { busy=false; }
}
async function main() {
  const previous=await db.from(TABLE).select('received_at,raw_payload').eq('secret_hash',owner).eq('strategy_id',STRATEGY).eq('signal_id','state').maybeSingle();
  if(previous.error)throw new Error('STATE_STORAGE_UNAVAILABLE');
  if(previous.data && Date.now()-Date.parse(previous.data.received_at)<15000)throw new Error('ANOTHER_HAMS_WORKER_ACTIVE');
  let saved=previous.data?.raw_payload;
  if(fs.existsSync(checkpoint)) { const local=JSON.parse(fs.readFileSync(checkpoint,'utf8')); if(local.owner===owner && Date.parse(local.savedAt)>Date.parse(previous.data?.received_at||'1970-01-01'))saved=local; }
  if(saved?.state) { state=saved.state; decisions=saved.decisions||[]; }
  // A restart never assumes missed price-path exits or revives an old pending entry.
  if(state.position) { state.status='RESTART_REQUIRES_REVIEW'; throw new Error('OPEN_POSITION_REQUIRES_REVIEW'); }
  pollAfter=saved?.pollAfter || previous.data?.received_at || now();
  connection=await credentials();
  const response=await fetch('https://public.fyers.in/sym_details/NSE_FO.csv',{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('CONTRACT_MASTER_UNAVAILABLE');
  master=parse(await response.text(),{skip_empty_lines:true}).filter(r=>r[13]==='NIFTY'&&['CE','PE'].includes(r[16])).map(r=>({id:r[9],expiry:day(new Date(Number(r[8])*1000).toISOString()),strike:Number(r[15]),side:r[16],lotSize:Number(r[3])})).filter(c=>c.expiry>=day(now()));
  if(!master.length)throw new Error('NO_CONTRACTS');
  const result=await api(`data/options-chain-v3?symbol=${encodeURIComponent(INDEX)}&strikecount=12`);
  const symbols=(result.data?.optionsChain||[]).filter(r=>['CE','PE'].includes(r.option_type)).map(r=>r.symbol);
  if(!symbols.length)throw new Error('NO_OPTION_SUBSCRIPTIONS');
  if(process.argv.includes('--check')) { console.log(JSON.stringify({accountBindingVerified:true,fyersDataAccess:true,optionSymbols:symbols.length,mode:'PAPER',stateWritten:false})); return; }
  lease=now();
  const claim=row('state',lease,{workerId,state,decisions,workerStatus:'CONNECTING'});
  const claimed=previous.data ? await db.from(TABLE).update(claim).eq('secret_hash',owner).eq('strategy_id',STRATEGY).eq('signal_id','state').eq('received_at',previous.data.received_at).select('id') : await db.from(TABLE).insert(claim).select('id');
  if(claimed.error || claimed.data?.length!==1)throw new Error('LEASE_CLAIM_FAILED');
  ack=Date.parse(lease);
  if(process.argv.includes('--arm'))state=setHamsEnabled(state,true);
  socket=fyersDataSocket.getInstance(`${connection.appId}:${connection.accessToken}`,directory,false);
  socket.on('connect',()=>{status='READY';quotes.clear();depths.clear();spot=null;socket.subscribe([INDEX,...new Set(symbols)]);socket.subscribe([...new Set(symbols)],true);});
  socket.on('message',onMessage);socket.on('error',()=>{status='FEED_ERROR';feedAt=null;});socket.on('close',()=>{status='FEED_DISCONNECTED';feedAt=null;});
  socket.connect(); if(socket.autoreconnect)socket.autoreconnect(50);
  save(); console.log('HAMS Final paper worker started; read-only FYERS data.');
  let lastRefresh=Date.now();
  while(!stopped) {
    await new Promise(r=>setTimeout(r,250));
    if(Date.now()-ack>2000&&!publishing) void publish().catch(()=>{status='LEASE_OR_STORAGE_LOST';stopped=true;});
    if(!busy) void poll().catch(()=>{status='SIGNAL_STORAGE_UNAVAILABLE';});
    tryEntry();
    if(pending && Date.now()-Date.parse(pending.signal.closedAt)>=180000) { decide(pending.signal,'MISSED_SIGNAL_CLOSE');pending=null;save(); }
    if(Date.now()-lastRefresh>60000&&!busy) {
      lastRefresh=Date.now();
      const updated=await credentials(); if(updated.accessToken!==connection.accessToken)throw new Error('FYERS_SESSION_CHANGED_RESTART');
      const updatedChain=await api(`data/options-chain-v3?symbol=${encodeURIComponent(INDEX)}&strikecount=12`);
      const ids=(updatedChain.data?.optionsChain||[]).filter(r=>['CE','PE'].includes(r.option_type)).map(r=>r.symbol);
      if(state.position)ids.push(state.position.contract.id);
      if(socket.isConnected()&&ids.length){socket.subscribe([...new Set(ids)]);socket.subscribe([...new Set(ids)],true);}
    }
  }
  throw new Error('HAMS_WORKER_STOPPED');
}
process.on('SIGTERM',()=>{stopped=true;save();socket?.close?.();process.exit(0);});
main().catch(e=>{stopped=true;try{save();}catch{} console.error(e.message);process.exit(1);});
