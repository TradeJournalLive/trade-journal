const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tradeKey = t => `${t.signalId}:${t.openedAt}`;
function validate(snapshot, owner) {
  const s = snapshot?.state;
  if (!snapshot || snapshot.owner !== owner || !s || typeof s.enabled !== 'boolean'
    || !Number.isFinite(s.balance) || !Number.isSafeInteger(s.nextLots) || s.nextLots < 1 || s.nextLots > 20
    || !Array.isArray(s.trades) || !Array.isArray(s.seen) || !Array.isArray(snapshot.decisions)
    || !Number.isFinite(Date.parse(snapshot.savedAt))) throw Error('HAMS_INVALID_SAVED_STATE');
  for (const t of s.trades) if (!t.signalId || !t.openedAt || !t.closedAt || !Number.isFinite(t.pnl)) throw Error('HAMS_INVALID_SAVED_TRADE');
  if (s.position && (!s.position.signalId || !s.position.openedAt || !(s.position.entry > 0) || !(s.position.quantity > 0))) throw Error('HAMS_INVALID_SAVED_POSITION');
  return snapshot;
}
function selectSnapshot(candidates, owner) {
  const valid = candidates.filter(Boolean).map(c => validate(c, owner));
  if (!valid.length) return null;
  valid.sort((a,b) => (a.revision || 0) - (b.revision || 0) || Date.parse(a.savedAt)-Date.parse(b.savedAt));
  const chosen = structuredClone(valid.at(-1));
  for (const older of valid.slice(0,-1)) checkTransition(older, chosen, false);
  return chosen;
}
function checkTransition(before, after, checkSwitch = true) {
  if (!before) return;
  const trades = new Set(after.state.trades.map(tradeKey));
  if (before.state.trades.some(t => !trades.has(tradeKey(t)))) throw Error('HAMS_HISTORY_REGRESSION');
  const p = before.state.position;
  if (p && tradeKey(p) !== (after.state.position ? tradeKey(after.state.position) : null) && !trades.has(tradeKey(p))
    && !(after.incidents || []).some(i => i.position && tradeKey(i.position) === tradeKey(p) && i.acknowledgedAt)) throw Error('HAMS_POSITION_DISAPPEARANCE');
  if (checkSwitch && before.state.enabled !== after.state.enabled && (!after.lastControl?.id || before.lastControl?.id === after.lastControl.id)) throw Error('HAMS_SWITCH_CHANGE_WITHOUT_CONTROL');
}
class HamsJournal {
  constructor(directory, owner) {
    this.owner = owner; this.directory = directory; this.initialized = false;
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const file = path.join(directory,'state.sqlite');
    this.db = new DatabaseSync(file);
    fs.chmodSync(file,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS identity(owner TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS snapshot(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0);');
    const identity = this.db.prepare('SELECT owner FROM identity').get();
    if (identity && identity.owner !== owner) { this.db.close(); throw Error('HAMS_JOURNAL_OWNER_MISMATCH'); }
    if (!identity) this.db.prepare('INSERT INTO identity(owner) VALUES(?)').run(owner);
    for (const suffix of ['-wal','-shm']) if(fs.existsSync(file+suffix))fs.chmodSync(file+suffix,0o600);
  }
  read() {
    const r = this.db.prepare('SELECT payload FROM snapshot WHERE id=1').get();
    return r ? validate(JSON.parse(r.payload),this.owner) : null;
  }
  initialize(snapshot) {
    validate(snapshot,this.owner);
    const previous = this.read();
    if(previous) checkTransition(previous,snapshot);
    this.revision = Math.max(previous?.revision || 0,snapshot.revision || 0);
    this.initialized = true;
  }
  save(value) {
    if (!this.initialized) throw Error('HAMS_STATE_NOT_INITIALIZED');
    const before = this.read();
    const snapshot = validate(structuredClone({...value,owner:this.owner,schemaVersion:2,revision:this.revision+1,savedAt:new Date().toISOString()}),this.owner);
    checkTransition(before,snapshot);
    const records = [];
    const add = (type,key,value,at) => records.push({id:digest([type,key]),type,value,at});
    const p = snapshot.state.position;
    if(p && (!before?.state.position || tradeKey(before.state.position)!==tradeKey(p)))add('ENTRY',tradeKey(p),p,p.openedAt);
    const previousTrades = new Set((before?.state.trades||[]).map(tradeKey));
    for(const t of snapshot.state.trades)if(!previousTrades.has(tradeKey(t)))add('TRADE',tradeKey(t),t,t.closedAt);
    const previousDecisions = new Map((before?.decisions||[]).map(d=>[d.id,JSON.stringify(d)]));
    for(const d of snapshot.decisions)if(previousDecisions.get(d.id)!==JSON.stringify(d))add('DECISION',[d.id,d.status,d.decidedAt||d.receivedAt],d,d.decidedAt||d.receivedAt);
    const previousIncidents = new Map((before?.incidents||[]).map(i=>[i.id,JSON.stringify(i)]));
    for(const i of snapshot.incidents||[])if(previousIncidents.get(i.id)!==JSON.stringify(i))add('INCIDENT',[i.id,i.acknowledgedAt||'unresolved'],i,i.acknowledgedAt||i.at);
    if(snapshot.lastControl?.id && snapshot.lastControl.id!==before?.lastControl?.id)add('CONTROL',snapshot.lastControl.id,snapshot.lastControl,snapshot.lastControl.at);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT INTO records(id,payload) VALUES(?,?) ON CONFLICT(id) DO NOTHING');
      for(const record of records){
        const existing = this.db.prepare('SELECT payload FROM records WHERE id=?').get(record.id);
        if(existing && existing.payload!==JSON.stringify(record))throw Error('HAMS_LEDGER_CONFLICT');
        insert.run(record.id,JSON.stringify(record));
      }
      this.db.prepare('INSERT INTO snapshot(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(snapshot));
      this.db.exec('COMMIT'); this.revision = snapshot.revision;
    } catch(e) { this.db.exec('ROLLBACK');throw e; }
    // This JSON is only a human-readable cache; SQLite is the atomic recovery source.
    try {
      const file = path.join(this.directory,'checkpoint.json');
      if(fs.existsSync(file))fs.copyFileSync(file,file+'.previous');
      const fd=fs.openSync(file+'.tmp','w',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(snapshot));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(file+'.tmp',file);
    } catch { /* A failed cache write must not undo the committed durable snapshot. */ }
    return snapshot;
  }
  pending(limit=50){return this.db.prepare('SELECT id,payload FROM records WHERE acknowledged=0 ORDER BY seq LIMIT ?').all(limit).map(r=>({id:r.id,record:JSON.parse(r.payload)}));}
  acknowledge(ids){const update=this.db.prepare('UPDATE records SET acknowledged=1 WHERE id=?');this.db.exec('BEGIN IMMEDIATE');try{for(const id of ids)update.run(id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
async function flushHamsRecords(journal, transport) {
  const rows = journal.pending(); if(!rows.length)return 0;
  // The transport must verify matching hashes after an idempotent insert/lost response.
  await transport(rows);
  journal.acknowledge(rows.map(r=>r.id)); return rows.length;
}
async function confirmHamsPublish(result, readBack, workerId, at) {
  if(!result.error && result.data?.length===1)return;
  const check=await readBack();
  if(check.error||check.data?.raw_payload?.workerId!==workerId||Date.parse(check.data.received_at)!==Date.parse(at))throw Error('LEASE_OR_STORAGE_LOST');
}
module.exports={HamsJournal,selectSnapshot,checkTransition,validate,flushHamsRecords,confirmHamsPublish,digest,tradeKey};
