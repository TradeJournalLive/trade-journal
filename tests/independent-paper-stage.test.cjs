const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {independentSelftest}=require('../scripts/independent-paper-selftest.cjs');
const {stageConfiguration}=require('../scripts/cloudways-independent-stage.cjs');
test('Cloudways self-test isolates both strategies and does not contact reporting or a broker',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage-test-'));
  try{const result=await independentSelftest(dir);assert.equal(result.status,'PASSED');assert.equal(result.externalRequests,0);assert.equal(result.checks.length,6);assert.deepEqual(fs.readdirSync(dir),[]);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Cloudways boot refuses temporary home and missing staging credential',()=>{
  assert.throws(()=>stageConfiguration({HOME:'/tmp',RIBBON_STAGE_TOKEN:'existing-staging-token'}),/PERSISTENT_HOME/);
  assert.throws(()=>stageConfiguration({HOME:os.homedir()}),/TOKEN_REQUIRED/);
  const config=stageConfiguration({HOME:os.homedir(),RIBBON_STAGE_TOKEN:'existing-staging-token',INDEPENDENT_PAPER_MODE:'LIVE',INDEPENDENT_SYNTHETIC_INPUT:'1'});
  assert.equal(config.INDEPENDENT_PAPER_MODE,'SHADOW');assert.equal(config.INDEPENDENT_SYNTHETIC_INPUT,'0');assert.notEqual(config.INDEPENDENT_PAPER_ADMIN_TOKEN,config.INDEPENDENT_PAPER_WEBHOOK_SECRET);assert.ok(config.INDEPENDENT_PAPER_DB.endsWith('/worker-private-storage/independent-shadow/shadow.sqlite'));
});
