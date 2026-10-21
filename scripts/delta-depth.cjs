const { crc32 } = require('node:zlib');

// Delta's ob_updates sizes are contract counts, not BTC amounts.
function createDeltaDepth(contractBtc) {
  let asks = new Map(), bids = new Map(), sequence = null, at = null, cached;
  const sorted = (map, buy) => [...map.values()].sort((a, b) => buy ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]));
  function reset() { asks.clear(); bids.clear(); sequence = null; at = null; cached = undefined; }
  function accept(frame) {
    if (frame.type !== 'ob_updates' || frame.sy !== 'BTCUSD') return false;
    try {
      if (!Number.isFinite(contractBtc) || contractBtc <= 0 || !['snapshot', 'update'].includes(frame.action)
        || !Number.isSafeInteger(frame.seq) || !Number.isInteger(frame.cs) || !Number.isFinite(Number(frame.ts))) throw Error('DELTA_DEPTH_INVALID');
      if (frame.action === 'update' && (sequence === null || frame.seq !== sequence + 1)) throw Error('DELTA_DEPTH_SEQUENCE_GAP');
      const nextAsks = frame.action === 'snapshot' ? new Map() : new Map(asks), nextBids = frame.action === 'snapshot' ? new Map() : new Map(bids);
      for (const [rows, map] of [[frame.a, nextAsks], [frame.b, nextBids]]) {
        if (!Array.isArray(rows)) throw Error('DELTA_DEPTH_INVALID');
        const seen = new Set();
        for (const row of rows) {
          if (!Array.isArray(row) || row.length !== 2) throw Error('DELTA_DEPTH_INVALID');
          const price = Number(row[0]), size = Number(row[1]);
          if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(size) || size < 0 || seen.has(price)) throw Error('DELTA_DEPTH_INVALID');
          seen.add(price);
          if (!size) map.delete(price); else map.set(price, [String(row[0]), String(row[1])]);
        }
      }
      const a = sorted(nextAsks, false), b = sorted(nextBids, true);
      if (!a.length || !b.length || Number(a[0][0]) < Number(b[0][0])) throw Error('DELTA_DEPTH_INVALID');
      const checksum = `${a.slice(0, 10).map(row => row.join(':')).join(',')}|${b.slice(0, 10).map(row => row.join(':')).join(',')}`;
      if (crc32(Buffer.from(checksum)) !== (frame.cs >>> 0)) throw Error('DELTA_DEPTH_CHECKSUM_MISMATCH');
      const timestamp = new Date(Number(frame.ts) / 1000).toISOString();
      if (at && Date.parse(timestamp) < Date.parse(at)) throw Error('DELTA_DEPTH_INVALID');
      asks = nextAsks; bids = nextBids; sequence = frame.seq; at = timestamp;
      const levels = rows => rows.slice(0, 50).map(([price, size]) => ({ price: Number(price), quantityBtc: Math.round(Number(size) * contractBtc * 1e12) / 1e12 }));
      cached = { at, sequence, asks: levels(a), bids: levels(b) };
      return true;
    } catch (error) { reset(); throw error; }
  }
  function snapshot() {
    return cached;
  }
  return { accept, reset, snapshot };
}
module.exports = { createDeltaDepth };
