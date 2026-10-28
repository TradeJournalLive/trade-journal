const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../app/lib/algo/signalGroups.ts'),m=new Module(file,module);
m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {signalGroup,signalGroups}=m.exports;
test('signal tabs replace tracking with HAMS without mixing normal NIFTY or BTC',()=>{
  assert.deepEqual(signalGroups.map(g=>g[0]),['NIFTY','NIFTY_HAMS','BTC']);
  assert.equal(signalGroup({symbol:'NSE:NIFTY',strategyId:'nifty_breakout_options_v1'}),'NIFTY');
  assert.equal(signalGroup({symbol:'NSE:NIFTY',strategyId:'nifty_hams_final_3m_v1'}),'NIFTY_HAMS');
  assert.equal(signalGroup({symbol:'NSE:NIFTY',strategyId:'nifty_confirmation_tracking_v1'}),null);
  assert.equal(signalGroup({symbol:'DELTAIN:BTCUSD.P',strategyId:'btc_delta_breakout_v1'}),'BTC');
  assert.equal(signalGroup({symbol:'DELTAIN:BTCUSD.P',strategyId:'nifty_hams_final_3m_v1'}),null);
  assert.equal(signalGroup({}),null);
});
