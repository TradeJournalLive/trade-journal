const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const file=path.resolve(__dirname,'../app/lib/algo/btcPaperEngine.ts'),copy=new Module(file,module);
copy._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {emptyBtcState,btcSignal,btcTick}=copy.exports;
const at=n=>new Date(Date.UTC(2026,10,5,4,0,n)).toISOString();
const tick=(n,price)=>({timestamp:at(n),tradeAt:at(n),quoteAt:at(n),price,bid:price-1,ask:price+1,bidBtc:2,askBtc:2,mark:price,markAt:at(n),maintenanceRate:.0025});
const signal=action=>({id:'late-'+action,action,symbol:'DELTAIN:BTCUSD.P',closedAt:at(0),receivedAt:at(2),high:100,low:90,signalPrice:95});
function setup(action){let s={...emptyBtcState(),enabled:true,previousTick:tick(-1,95)};for(let n=0;n<3;n++)s=btcTick(s,tick(n,n===0?95:action==='BUY'?101+n:89-n));return btcSignal(s,signal(action),at(2));}
test('verified earlier BUY breakout enters at current ask and retains late label through exit',()=>{let s=setup('BUY');assert.equal(s.setup.lateEntry,true);s=btcTick(s,tick(3,104));assert.equal(s.position.entry,105);assert.equal(s.position.stop,90);assert.equal(s.position.target,180);assert.equal(s.position.lateEntry,true);assert.match(s.decisions.at(-1).reason,/\(Entered late\)/);s=btcTick(s,tick(4,89));assert.equal(s.trades[0].lateEntry,true);});
test('verified earlier SELL breakout enters at current bid',()=>{let s=setup('SELL');s=btcTick(s,tick(3,86));assert.equal(s.position.entry,85);assert.equal(s.position.stop,100);assert.equal(s.position.lateEntry,true);});
test('late setup cannot enter after price reverses inside the level',()=>{let s=setup('BUY');s=btcTick(s,tick(3,99));assert.equal(s.position,null);assert.equal(s.setup,null);s=btcTick(s,tick(4,105));assert.equal(s.position,null);});
test('late entry does not bypass ten-candle expiry or missing history',()=>{let s=setup('BUY');s=btcTick(s,tick(600,105));assert.equal(s.position,null);assert.equal(s.setup,null);s=btcSignal({...emptyBtcState(),enabled:true,previousTick:tick(2,103),priceHistory:[]},signal('BUY'),at(2));assert.equal(s.status,'UNVERIFIABLE_BREAKOUT_HISTORY');});
test('stale execution quotes never create a late fill',()=>{let s=setup('BUY');s=btcTick(s,{...tick(3,104),quoteAt:at(-10)});assert.equal(s.position,null);});
