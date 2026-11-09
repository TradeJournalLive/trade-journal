function shouldPublishSnapshot({ ageMs, changed = false, active = false, unsynced = false, retrying = false }) {
  return !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 9000
    || changed || active || unsynced || retrying;
}

module.exports = { shouldPublishSnapshot };
