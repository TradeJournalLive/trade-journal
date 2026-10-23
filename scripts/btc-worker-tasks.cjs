// One in-flight request per task, but independent tasks never wait for each other.
function startTask({ name, intervalMs, task, onError, clock = globalThis }) {
  let stopped = false, timer, active = false, failures = 0, queued = false;
  const now = () => clock.now ? clock.now() : Date.now();
  async function run() {
    if (stopped || active) return;
    const started = now(); queued = false;
    active = true;
    try { await task(); failures = 0; } catch (error) { failures++; onError(name, error); }
    finally { active = false; if (!stopped) timer = clock.setTimeout(run, queued ? 0 : failures ? Math.min(intervalMs, 500 * 2 ** Math.min(failures - 1, 2)) : Math.max(25, intervalMs - (now() - started))); }
  }
  void run();
  const stop = () => { stopped = true; clock.clearTimeout(timer); };
  stop.trigger = () => { if (stopped) return; if (active) { queued = true; return; } clock.clearTimeout(timer); timer = clock.setTimeout(run, 0); };
  return stop;
}

function createTickAudit(write) {
  let window, previousAt;
  return {
    add(tick) {
      const second = Math.floor(Date.parse(tick.timestamp) / 1000);
      if (window && window.second !== second) this.flush();
      if (!window) window = { second, first: tick.timestamp, last: tick.timestamp, low: tick.price, high: tick.price, updates: 0, maxGapMs: 0 };
      window.maxGapMs = Math.max(window.maxGapMs, previousAt ? Date.parse(tick.timestamp) - previousAt : 0);
      previousAt = Date.parse(tick.timestamp);
      window.last = tick.timestamp; window.low = Math.min(window.low, tick.price); window.high = Math.max(window.high, tick.price); window.updates++;
    },
    flush() { if (window) { write('TICK_WINDOW', window); window = undefined; } },
  };
}
module.exports = { startTask, createTickAudit };
