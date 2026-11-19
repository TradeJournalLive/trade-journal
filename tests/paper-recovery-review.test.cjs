const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(){const f=path.resolve(__dirname,'../app/lib/algo/paperRecoveryReview.ts'),m=new Module(f,module);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const {recoverySessionEnd,normalizeRecoveryCandles,reviewRecoveryCandles}=load(),at='2026-11-19T09:02:30.600Z',now=Date.parse('2026-11-19T10:00:00Z');
const p={signalId:'s',openedAt:'2026-11-19T07:51:07Z',entry:157.3,stop:137.3,target:257.3,quantity:195,lots:3,contract:{id:'NSE:NIFTY26NOV25350CE',side:'CE'}};
const candle=(at,o=230,h=235,l=225,c=231)=>({at,open:o,high:h,low:l,close:c,volume:1000});
test('review uses the actual 14:50 IST time-exit rule and never marks candle fills verified',()=>{assert.equal(recoverySessionEnd(p.openedAt),'2026-11-19T09:20:00.000Z');const r=reviewRecoveryCandles(p,at,[candle('2026-11-19T09:02:00Z'),candle('2026-11-19T09:03:00Z',250,260,245,258)],[],now);assert.equal(r.reason,'PREMIUM_TARGET');assert.equal(r.exitEstimate,257.3);assert.equal(r.fillVerified,false);assert.equal(r.status,'CANDLE_RECONSTRUCTION_AVAILABLE');});
test('same-bar SL and target, partial pause bar, missing bars and opposite signals remain ambiguous',()=>{
 for(const [bars,opposite] of [[[candle('2026-11-19T09:02:00Z',230,260,120,200)],[]],[[candle('2026-11-19T09:02:00Z',250,260,245,258)],[]],[[candle('2026-11-19T09:04:00Z',250,260,245,258)],[]],[[candle('2026-11-19T09:02:00Z'),candle('2026-11-19T09:03:00Z',250,260,245,258)],['2026-11-19T09:03:10Z']]]){const r=reviewRecoveryCandles(p,at,bars,opposite,now);assert.equal(r.status,'AMBIGUOUS_HISTORY');assert.equal(r.exitEstimate,null);assert.equal(r.fillVerified,false);}
});
test('normalization rejects malformed and duplicate bars and discards incomplete candles',()=>{
 const t=Date.parse('2026-11-19T09:02:00Z')/1000,row=[t,230,235,225,231,1000];assert.equal(normalizeRecoveryCandles([row],t*1000+59999).length,0);assert.equal(normalizeRecoveryCandles([row],now).length,1);
 for(const rows of [[row,row],[[t,230,220,225,231,1000]],[[t,230,235,225,231,-1]],[[t+1,230,235,225,231,1000]]])assert.throws(()=>normalizeRecoveryCandles(rows,now));
});
test('gap below stop estimates the bar open, never a guaranteed stop-price fill',()=>{const r=reviewRecoveryCandles(p,at,[candle('2026-11-19T09:02:00Z'),candle('2026-11-19T09:03:00Z',120,130,110,125)],[],now);assert.equal(r.reason,'PREMIUM_SL');assert.equal(r.exitEstimate,120);assert.equal(r.fillVerified,false);});
test('missing time-exit bar leaves the result unverified rather than closing at the last known price',()=>{const r=reviewRecoveryCandles(p,at,[candle('2026-11-19T09:02:00Z')],[],now);assert.equal(r.status,'INCOMPLETE_HISTORY');assert.equal(r.exitEstimate,null);});
