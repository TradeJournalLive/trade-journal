const { parse } = require('csv-parse/sync');
const { readDepth } = require('./nifty-depth.cjs');
const INDEX = 'NSE:NIFTY50-INDEX';

function makeQuoteReader(contracts, onTick, clock = Date.now) {
  const quotes = new Map(), depths = new Map();
  let spot;
  const fresh = (timestamp, now) => Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 5000;
  return {
    clear() { quotes.clear(); depths.clear(); spot = undefined; },
    receive(message) {
      for (const row of Array.isArray(message) ? message : [message]) {
        if (!row?.symbol) continue;
        const now = clock(), at = new Date(now).toISOString();
        if (row.type === 'dp') {
          const depth = readDepth(row, at);
          if (depth) depths.set(row.symbol, depth);
        } else {
          const time = Number(row.exch_feed_time) * 1000;
          if (!fresh(time, now)) continue;
          if (row.symbol === INDEX && Number(row.ltp) > 0) spot = { price: Number(row.ltp), time };
          else if (Number(row.bid_price) > 0 && Number(row.ask_price) >= Number(row.bid_price)) {
            quotes.set(row.symbol, { at: new Date(time).toISOString(), bid: Number(row.bid_price), ask: Number(row.ask_price), bidSize: Number(row.bid_size), askSize: Number(row.ask_size) });
          }
        }
        if (!spot || !fresh(spot.time, now)) continue;
        const chain = contracts.flatMap(contract => {
          const quote = quotes.get(contract.id), depth = depths.get(contract.id);
          if (!quote || !fresh(Date.parse(quote.at), now)) return [];
          const matching = depth && fresh(Date.parse(depth.depthAt), now)
            && depth.asks[0]?.price === quote.ask && depth.bids[0]?.price === quote.bid;
          return [{ ...contract, ...quote, ...(matching ? depth : {}) }];
        });
        onTick({ at, spot: spot.price, chain });
      }
    },
  };
}

async function startFyersStageFeed({ appId, accessToken, directory, onTick, onGap = () => {} }) {
  const auth = `${appId}:${accessToken}`;
  const day = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
  const [master, chain] = await Promise.all([
    fetch('https://public.fyers.in/sym_details/NSE_FO.csv', { signal: AbortSignal.timeout(15000) }),
    fetch(`https://api-t1.fyers.in/data/options-chain-v3?symbol=${encodeURIComponent(INDEX)}&strikecount=12`, {
      headers: { Authorization: auth }, signal: AbortSignal.timeout(10000),
    }),
  ]);
  if (!master.ok || !chain.ok) throw Error('Staging FYERS market data unavailable');
  const body = await chain.json();
  if (body.s !== 'ok') throw Error('Staging FYERS option chain unavailable');
  const symbols = new Set((body.data?.optionsChain || []).filter(r => ['CE', 'PE'].includes(r.option_type)).map(r => r.symbol));
  const contracts = parse(await master.text(), { skip_empty_lines: true })
    .filter(r => symbols.has(r[9]) && r[13] === 'NIFTY' && ['CE', 'PE'].includes(r[16]) && Number.isFinite(Number(r[8])))
    .map(r => ({ id: r[9], expiry: day(Number(r[8]) * 1000), strike: Number(r[15]), side: r[16], lotSize: Number(r[3]) }))
    .filter(r => r.expiry >= day(Date.now()) && r.strike > 0 && Number.isSafeInteger(r.lotSize) && r.lotSize > 0);
  if (!contracts.length) throw Error('No staging FYERS option contracts');
  const reader = makeQuoteReader(contracts, onTick);
  const { fyersDataSocket } = require('fyers-api-v3');
  const socket = fyersDataSocket.getInstance(auth, directory, false);
  const ids = contracts.map(c => c.id);
  socket.on('connect', () => { reader.clear(); socket.subscribe([INDEX, ...ids]); socket.subscribe(ids, true); });
  socket.on('message', message => {
    try { reader.receive(message); } catch { reader.clear(); console.warn('Ribbon staging tick rejected'); }
  });
  socket.on('error', () => { reader.clear(); onGap('FYERS_SOCKET_ERROR'); });
  socket.on('close', () => { reader.clear(); onGap('FYERS_DISCONNECTED'); });
  socket.connect();
  socket.autoreconnect?.(50);
  return () => socket.close?.();
}

module.exports = { makeQuoteReader, startFyersStageFeed };
