// FYERS dp messages have no exchange timestamp; retain their local receipt time.
function readDepth(row, receivedAt) {
  if (row?.type !== 'dp' || !row.symbol) return null;
  const levels = side => Array.from({ length: 5 }, (_, i) => ({ price: Number(row[`${side}_price${i + 1}`]), quantity: Number(row[`${side}_size${i + 1}`]) }))
    .filter(level => Number.isFinite(level.price) && level.price > 0 && Number.isSafeInteger(level.quantity) && level.quantity > 0);
  const asks = levels('ask'), bids = levels('bid');
  if (!asks.length || !bids.length || asks[0].price < bids[0].price) return null;
  return { asks, bids, depthAt: receivedAt };
}
function withDepth(quote, depth, now) {
  if (!quote || !depth || Date.parse(now) - Date.parse(depth.depthAt) < 0 || Date.parse(now) - Date.parse(depth.depthAt) > 5000
    || quote.ask !== depth.asks[0].price || quote.bid !== depth.bids[0].price) return quote;
  // Never add the best ask twice or combine depth from different snapshots.
  return { ...quote, asks: depth.asks, bids: depth.bids, depthAt: depth.depthAt };
}
module.exports = { readDepth, withDepth };
