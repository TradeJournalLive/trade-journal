const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createClient } = require('@supabase/supabase-js');

const devHost = 'intvhkvqselqvrvzvsqz.supabase.co';
function createStageTransport({ url, key, instance }) {
  const endpoint = new URL(url);
  if (endpoint.origin !== `https://${devHost}` || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
    !key || !instance || instance.length < 16) throw Error('Invalid dev reporting configuration');
  const db = createClient(endpoint.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = createHash('sha256').update(`ribbon-stage:${instance}`).digest('hex');
  const strategy = '__ribbon_stage_report__';
  return async records => {
    const at = new Date().toISOString();
    const rows = records.map(record => ({
      secret_hash: owner, strategy_id: strategy, signal_id: record.id, received_at: at,
      symbol: 'NSE:NIFTY', action: 'EXIT', status: 'VALIDATED', accepted: false,
      execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', raw_payload: { record },
    }));
    const table = () => db.from('tradingview_signal_events');
    const write = await table().upsert(rows, { onConflict: 'secret_hash,strategy_id,signal_id', ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(5000));
    if (write.error) throw Error('Dev reporting write unavailable');
    const read = await table().select('signal_id,raw_payload').eq('secret_hash', owner).eq('strategy_id', strategy)
      .in('signal_id', records.map(record => record.id)).abortSignal(AbortSignal.timeout(5000));
    if (read.error) throw Error('Dev reporting verification unavailable');
    const stored = new Map(read.data.map(row => [row.signal_id, row.raw_payload.record]));
    if (records.some(record => !isDeepStrictEqual(stored.get(record.id), record))) throw Error('Dev reporting record mismatch');
  };
}

module.exports = { createStageTransport };
