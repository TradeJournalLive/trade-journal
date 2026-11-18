const fs = require('node:fs');
const path = require('node:path');

// Optional diagnostics, not execution history. Never remove existing evidence.
function createTickAudit({ directory, io = fs, clock = Date.now, maxBytes = 128 * 1024 * 1024, dailyBytes = 16 * 1024 * 1024, onDisabled = () => {} }) {
  let total = 0, initialized = false, disabled = false, lastSample = -Infinity;
  const sizes = new Map();
  function disable(reason, error) {
    disabled = true;
    try { onDisabled({ reason, code: String(error?.code || '') }); } catch { /* Optional output cannot stop execution. */ }
  }
  return function record(tick, activeContractId) {
    if (disabled || clock() - lastSample < 1000) return;
    try {
      if (!initialized) {
        for (const name of io.readdirSync(directory).filter(name => /^market-ticks-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))) {
          const size = io.statSync(path.join(directory, name)).size;
          sizes.set(name, size); total += size;
        }
        initialized = true;
      }
      const at = new Date(clock()).toISOString(), day = new Date(clock() + 330 * 60000).toISOString().slice(0, 10);
      const name = `market-ticks-${day}.jsonl`, size = sizes.get(name) || 0;
      const q = tick.contracts?.find(q => q.id === activeContractId);
      const data = { timestamp: tick.timestamp, spot: tick.price, ...(q ? { option: { id: q.id, timestamp: q.timestamp, bid: q.bid, ask: q.ask, bidSize: q.bidSize, askSize: q.askSize } } : {}) };
      const line = JSON.stringify({ at, type: 'TICK_SAMPLE', data }) + '\n', bytes = Buffer.byteLength(line);
      if (total + bytes > maxBytes || size + bytes > dailyBytes) { disable('OPTIONAL_TICK_AUDIT_BUDGET_REACHED'); return; }
      io.appendFileSync(path.join(directory, name), line, { mode: 0o600 });
      sizes.set(name, size + bytes); total += bytes; lastSample = clock();
    } catch (error) { disable('OPTIONAL_TICK_AUDIT_WRITE_FAILED', error); }
  };
}

module.exports = { createTickAudit };
