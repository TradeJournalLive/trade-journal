const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {isDeepStrictEqual}=require('node:util');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const strategies=new Set(['current','hams']);
const issue=code=>Object.assign(new Error(code),{code});

// One local, fenced writer; this is not cross-server failover or a broker order engine.
class IndependentPaperStore {
  constructor(file,owner,{clock=Date.now,mode='SHADOW'}={}) {
    if(!owner||mode!=='SHADOW')throw issue('SHADOW_MODE_REQUIRED');
    this.owner=owner;this.clock=clock;this.mode=mode;
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(file);fs.chmodSync(file,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250;
      CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS writer(id INTEGER PRIMARY KEY CHECK(id=1),worker TEXT NOT NULL,epoch INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS states(strategy TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,strategy TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,processed INTEGER NOT NULL DEFAULT 0,UNIQUE(strategy,id));
      CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,body TEXT NOT NULL);
    `);
    try{this.tx(()=>{
      const old=this.db.prepare('SELECT owner,mode FROM identity WHERE id=1').get();
      if(old&&(old.owner!==owner||old.mode!==mode))throw issue('EXECUTION_STORE_IDENTITY_MISMATCH');
      this.db.prepare('INSERT OR IGNORE INTO identity VALUES(1,?,?)').run(owner,mode);
    });}catch(error){this.db.close();throw error;}
    for(const suffix of ['-wal','-shm'])if(fs.existsSync(file+suffix))fs.chmodSync(file+suffix,0o600);
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();if(value?.then)throw issue('ASYNC_REDUCER_FORBIDDEN');this.db.exec('COMMIT');return value;}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}}
  validStrategy(strategy){if(!strategies.has(strategy))throw issue('UNKNOWN_PAPER_STRATEGY');}
  initialize(strategy,state){this.validStrategy(strategy);this.validate(state,strategy);this.db.prepare('INSERT OR IGNORE INTO states VALUES(?,0,?)').run(strategy,JSON.stringify(state));}
  validate(state,strategy){const r=state?.rules;if(!r||r.version!==2||r.interval!==(strategy==='current'?1:3)||r.rangeFilter!==(strategy==='current')||!Number.isFinite(r.balance)||!Array.isArray(r.trades)||!Array.isArray(r.ticks)||!Array.isArray(r.seen)||!Array.isArray(r.decisions))throw issue('INVALID_EXECUTION_STATE');}
  read(strategy){this.validStrategy(strategy);const row=this.db.prepare('SELECT revision,body FROM states WHERE strategy=?').get(strategy);return row?{revision:row.revision,state:JSON.parse(row.body)}:null;}
  claim(worker,ttl=15000){if(!worker||ttl!==15000)throw issue('INVALID_LOCAL_WRITER');return this.tx(()=>{const previous=this.db.prepare('SELECT * FROM writer WHERE id=1').get(),now=this.clock();if(previous&&previous.expires>now)throw issue('LOCAL_WRITER_ALREADY_ACTIVE');const epoch=(previous?.epoch||0)+1;this.db.prepare('INSERT INTO writer VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET worker=excluded.worker,epoch=excluded.epoch,expires=excluded.expires').run(worker,epoch,now+ttl);return {worker,epoch};});}
  assertWriter(token){const row=this.db.prepare('SELECT * FROM writer WHERE id=1').get();if(!row||row.worker!==token?.worker||row.epoch!==token?.epoch||row.expires<=this.clock())throw issue('LOCAL_WRITER_FENCED');}
  renew(token){return this.tx(()=>{this.assertWriter(token);this.db.prepare('UPDATE writer SET expires=? WHERE id=1').run(this.clock()+15000);});}
  release(token){this.tx(()=>{this.assertWriter(token);this.db.prepare('UPDATE writer SET expires=0 WHERE id=1').run();});}
  receive(strategy,signal){this.validStrategy(strategy);if(!signal?.id||Buffer.byteLength(JSON.stringify(signal))>16384)throw issue('INVALID_LOCAL_SIGNAL');return this.tx(()=>{const previous=this.db.prepare('SELECT body FROM inbox WHERE strategy=? AND id=?').get(strategy,signal.id);if(previous){const old=JSON.parse(previous.body),incoming={...signal,receivedAt:old.receivedAt};if(!isDeepStrictEqual(old,incoming))throw issue('DUPLICATE_SIGNAL_CONFLICT');return {stored:true,duplicate:true};}this.db.prepare('INSERT INTO inbox(strategy,id,body) VALUES(?,?,?)').run(strategy,signal.id,JSON.stringify(signal));return {stored:true,duplicate:false};});}
  record(value){const existing=this.db.prepare('SELECT body FROM outbox WHERE id=?').get(value.id);if(existing&&!isDeepStrictEqual(JSON.parse(existing.body),value))throw issue('OUTBOX_RECORD_CONFLICT');this.db.prepare('INSERT OR IGNORE INTO outbox(id,body) VALUES(?,?)').run(value.id,JSON.stringify(value));}
  advance(strategy,token,reduce,{signal=false,expectedRevision}={}){return this.tx(()=>{
    this.assertWriter(token);const current=this.read(strategy);if(!current)throw issue('EXECUTION_STATE_NOT_INITIALIZED');if(expectedRevision!==undefined&&current.revision!==expectedRevision)throw issue('STALE_EXECUTION_REVISION');
    const row=signal&&this.db.prepare('SELECT seq,body FROM inbox WHERE strategy=? AND processed=0 ORDER BY seq LIMIT 1').get(strategy);if(signal&&!row)return null;
    const next=reduce(structuredClone(current.state),row?JSON.parse(row.body):null);if(next?.then)throw issue('ASYNC_REDUCER_FORBIDDEN');this.validate(next.state,strategy);
    const before=current.state.rules,after=next.state.rules,key=p=>p&&p.signalId+':'+p.openedAt;
    if(before.trades.some(t=>!after.trades.some(v=>key(v)===key(t))))throw issue('EXECUTION_HISTORY_REGRESSION');
    if(before.position&&key(after.position)!==key(before.position)&&!after.trades.some(t=>key(t)===key(before.position))&&!next.state.review?.acknowledgedAt)throw issue('POSITION_DISAPPEARANCE');
    for(const record of next.records||[]){this.record({...record,owner:this.owner,strategy,mode:this.mode});if(record.kind==='INCIDENT'&&record.value?.id){const value={...record.value,strategy};if(Buffer.byteLength(JSON.stringify(value))>65536)throw issue('INVALID_INCIDENT_SIZE');this.db.prepare('INSERT OR IGNORE INTO incidents VALUES(?,?)').run(value.id,JSON.stringify(value));}}
    this.db.prepare('UPDATE states SET revision=revision+1,body=? WHERE strategy=?').run(JSON.stringify(next.state),strategy);
    if(row)this.db.prepare('UPDATE inbox SET processed=1 WHERE seq=?').run(row.seq);
    return {revision:current.revision+1,state:next.state};
  });}
  incident(value){if(!value?.id||Buffer.byteLength(JSON.stringify(value))>65536)throw issue('INVALID_INCIDENT_SIZE');return this.tx(()=>{const previous=this.db.prepare('SELECT body FROM incidents WHERE id=?').get(value.id);if(previous){if(!isDeepStrictEqual(JSON.parse(previous.body),value))throw issue('INCIDENT_CONFLICT');return;}this.db.prepare('INSERT INTO incidents VALUES(?,?)').run(value.id,JSON.stringify(value));this.record({id:'incident:'+value.id,kind:'INCIDENT',owner:this.owner,strategy:value.strategy,mode:this.mode,value});});}
  incidents(limit=25){return this.db.prepare('SELECT body FROM incidents ORDER BY rowid DESC LIMIT ?').all(Math.min(100,Math.max(1,limit))).map(r=>JSON.parse(r.body));}
  pending(limit=25){return this.db.prepare('SELECT id,body FROM outbox WHERE sent=0 ORDER BY seq LIMIT ?').all(limit).map(r=>JSON.parse(r.body));}
  async flush(transport){if(this.flushing)return 0;this.flushing=true;try{const rows=this.pending();if(!rows.length)return 0;const ack=await transport(rows);if(!Array.isArray(ack)||!rows.every(r=>ack.includes(r.id)))throw issue('REPORTING_ACK_MISSING');this.tx(()=>{for(const row of rows)this.db.prepare('UPDATE outbox SET sent=1 WHERE id=?').run(row.id);});return rows.length;}finally{this.flushing=false;}}
  health(){return {mode:this.mode,realOrdersEnabled:false,pendingSignals:this.db.prepare('SELECT COUNT(*) n FROM inbox WHERE processed=0').get().n,pendingReports:this.db.prepare('SELECT COUNT(*) n FROM outbox WHERE sent=0').get().n};}
  close(){this.db.close();}
}
module.exports={IndependentPaperStore,hash,issue};
