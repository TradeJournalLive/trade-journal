const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const result={configured:false,checkedAt:null,database:{ok:false},fyers:{ok:false}};
let busy=false;
function decrypt(sealed,prefix){
  const b=Buffer.from(sealed,'base64url'),key=crypto.createHash('sha256').update(`${prefix}:${process.env.ALGO_CONNECTION_ENCRYPTION_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
  const c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));
  return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');
}
async function check(){
  if(busy)return;
  const env=process.env;
  if(!env.PROBE_CLAIM_HASH||!env.PROBE_WEBHOOK_DIGEST||!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return;
  busy=true;result.configured=true;result.checkedAt=new Date().toISOString();result.fyers={ok:false};
  const start=Date.now();let stage='database';
  async function one(strategy,owner,id){
    const url=new URL('/rest/v1/tradingview_signal_events',env.NEXT_PUBLIC_SUPABASE_URL);
    for(const [k,v] of Object.entries({select:'raw_payload',strategy_id:`eq.${strategy}`,secret_hash:`eq.${owner}`,signal_id:`eq.${id}`,limit:'2'}))url.searchParams.set(k,v);
    const r=await fetch(url,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('DATABASE_HTTP_'+r.status);
    const rows=await r.json();if(!Array.isArray(rows)||rows.length!==1)throw Error('ACCOUNT_BINDING_NOT_FOUND');
    return rows[0].raw_payload;
  }
  try{
    const claim=await one('__account_connections__',env.PROBE_CLAIM_HASH,'webhook');
    if(!claim.user)throw Error('ACCOUNT_CLAIM_INVALID');
    const key=crypto.createHash('sha256').update(`account:${env.ALGO_CONNECTION_ENCRYPTION_KEY||env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
    const owner=crypto.createHmac('sha256',key).update(`account:${claim.user}`).digest('hex');
    const webhook=await one('__account_connections__',owner,'webhook');
    if(hash(decrypt(webhook.sealed,'account'))!==env.PROBE_WEBHOOK_DIGEST)throw Error('ACCOUNT_OWNER_MISMATCH');
    const binding=await one('__account_connections__',owner,'fyers');
    const connection=await one('__fyers_connection__',hash(decrypt(binding.sealed,'account')),'credentials');
    const credentials=JSON.parse(decrypt(connection.sealed,'fyers'));
    result.database={ok:true,latencyMs:Date.now()-start,ownerVerified:true};
    stage='fyers';
    const begin=Date.now();
    // Only this fixed read-only market-data endpoint is reachable by this test.
    const r=await fetch('https://api-t1.fyers.in/data/options-chain-v3?symbol=NSE%3ANIFTY50-INDEX&strikecount=2',{headers:{Authorization:`${credentials.appId}:${credentials.accessToken}`},signal:AbortSignal.timeout(10000)});
    const data=await r.json();
    result.fyers={ok:r.ok&&data.s==='ok',httpStatus:r.status,code:data.code??null,latencyMs:Date.now()-begin,optionContracts:Array.isArray(data.data?.optionsChain)?data.data.optionsChain.filter(x=>['CE','PE'].includes(x.option_type)).length:0};
  }catch(e){result[stage]={ok:false,reason:/^(DATABASE_HTTP_\d+|ACCOUNT_[A-Z_]+)$/.test(e.message)?e.message:e.name==='TimeoutError'?'REQUEST_TIMEOUT':'INTEGRATION_CHECK_FAILED',latencyMs:Date.now()-start};}
  finally{busy=false;}
}
void check();const timer=setInterval(check,60000);
module.exports={result,stop:()=>clearInterval(timer)};
