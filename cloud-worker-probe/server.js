// Credential-free infrastructure test. No trading code or production data access.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const directory = process.env.PROBE_DATA_DIR || path.join(__dirname, 'storage');
fs.mkdirSync(directory, {recursive: true, mode: 0o700});
const db = new DatabaseSync(path.join(directory, 'probe.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS boots (id INTEGER PRIMARY KEY, at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pulses (id INTEGER PRIMARY KEY CHECK(id=1), count INTEGER NOT NULL); INSERT OR IGNORE INTO pulses VALUES (1,0)');
db.prepare('INSERT INTO boots (at) VALUES (?)').run(new Date().toISOString());
const started = Date.now();
let storageError = false, feed = {ok: false, checkedAt: null, latencyMs: null};
const pulse = setInterval(() => {
  try { db.exec('UPDATE pulses SET count=count+1 WHERE id=1'); storageError=false; }
  catch { storageError=true; }
}, 1000);
let checking = false;
async function checkFeed() {
  if (checking) return;
  checking=true;
  const begin=Date.now();
  try {
    const response=await fetch('https://api.india.delta.exchange/v2/tickers/BTCUSD', {signal: AbortSignal.timeout(5000)});
    const value=await response.json();
    feed={ok:response.ok && value.success===true && Number(value.result?.mark_price)>0, checkedAt:new Date().toISOString(), latencyMs:Date.now()-begin};
  } catch { feed={ok:false,checkedAt:new Date().toISOString(),latencyMs:Date.now()-begin}; }
  finally {checking=false;}
}
void checkFeed();
const feedTimer=setInterval(checkFeed,15000);
const server=http.createServer((req,res)=>{
  if(req.url!=='/' && req.url!=='/health'){res.writeHead(404);res.end();return;}
  let bootCount=0,pulses=0;
  try {bootCount=db.prepare('SELECT count(*) AS n FROM boots').get().n;pulses=db.prepare('SELECT count FROM pulses WHERE id=1').get().count;}catch{storageError=true;}
  res.writeHead(storageError?503:200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({mode:'INFRASTRUCTURE_PROBE_ONLY',tradingEnabled:false,node:process.versions.node,uptimeSeconds:Math.floor((Date.now()-started)/1000),storage:{ok:!storageError,bootCount,pulses},deltaPublicRest:feed}));
});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Credential-free hosting probe listening'));
function stop(){clearInterval(pulse);clearInterval(feedTimer);server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
