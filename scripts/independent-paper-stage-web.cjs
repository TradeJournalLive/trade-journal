const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function savePrivate(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function readFyersSession(file,appId){if(!fs.existsSync(file))return null;const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.appId!==appId||typeof v.accessToken!=='string'||!v.accessToken)throw Error('STAGING_FYERS_SESSION_IDENTITY_MISMATCH');return v;}
function createStageWeb({origin,password,appId,appSecret,sessionFile,getEngine,getRuntime=()=>({}),signalConfigurationVerified=false,request=fetch,clock=Date.now}){
  if(!origin||new URL(origin).protocol!=='https:')throw Error('EXPLICIT_HTTPS_STAGING_ORIGIN_REQUIRED');
  const sessions=new Map();let failures=[],lastAuthError=null;
  const callback=origin+'/stage/fyers/callback',configured=Boolean(appId&&appSecret);
  const adminConfiguration=!password?'MISSING':password.length<20?'TOO_SHORT':'READY';
  function page(res,status,body){res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://api-t1.fyers.in https://login.fyers.in; base-uri 'none'; frame-ancestors 'none'"});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Independent Paper Test</title><style>body{margin:0;font:15px system-ui;color:#172026;background:#f5f7f8}main{max-width:800px;margin:32px auto;padding:24px}h1{font-size:26px}h2{font-size:18px}section{padding:20px 0;border-top:1px solid #ced5d9}label{display:block;margin:12px 0}input{box-sizing:border-box;max-width:100%;padding:10px;border:1px solid #9faeb6;border-radius:4px}button{padding:10px 14px;background:#176c48;color:white;border:0;border-radius:4px;cursor:pointer}button:disabled{opacity:.45}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #dce1e4}a{color:#1559a0}small{color:#51616a}code{overflow-wrap:anywhere}</style></head><body><main><h1>Independent Paper Test</h1><p><strong>SHADOW · Broker orders disabled</strong></p>'+body+'</main></body></html>');}
  const redirect=(res,to)=>{res.writeHead(303,{location:to,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();};
  async function form(req){let n=0,parts=[];for await(const chunk of req){n+=chunk.length;if(n>4096)throw Error('FORM_TOO_LARGE');parts.push(chunk);}return new URLSearchParams(Buffer.concat(parts).toString('utf8'));}
  function current(req){for(const [id,s] of sessions)if(s.expires<clock())sessions.delete(id);const id=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-stage='))?.slice(13);return {id,session:sessions.get(id)};}
  const input=s=>'<input type="hidden" name="csrf" value="'+s.csrf+'">';
  const flat=()=>['current','hams'].every(s=>{const r=getEngine().read(s).state.rules;return !r.enabled&&!r.position&&!r.setup;});
  const ready=()=>{const h=getRuntime();return signalConfigurationVerified&&h.runnerStatus==='RUNNING'&&h.feed?.configured&&h.feed?.ageMs!==null&&h.feed?.ageMs<=5000;};
  async function handle(req,res){
    const url=new URL(req.url,origin),route=url.pathname;
    if(route==='/'&&req.method==='GET'){redirect(res,'/stage');return true;}
    if(!route.startsWith('/stage'))return false;
    if(adminConfiguration!=='READY'){page(res,503,'<h2>Private setup required</h2><p>'+(adminConfiguration==='TOO_SHORT'?'Staging password must contain at least 20 characters.':'Staging administrator password is not configured.')+'</p>');return true;}
    const {session,id}=current(req);
    if(route==='/stage/login'&&req.method==='POST'){
      if(req.headers.origin!==origin){page(res,403,'<p>Origin rejected.</p>');return true;}
      failures=failures.filter(at=>at>clock()-60000);if(failures.length>=10){page(res,429,'<p>Login rate limit reached.</p>');return true;}
      const body=await form(req);if(!equal(body.get('password'),password)){failures.push(clock());page(res,401,'<p>Invalid staging password.</p>');return true;}
      if(sessions.size>=16)sessions.delete(sessions.keys().next().value);
      const key=crypto.randomBytes(32).toString('hex');sessions.set(key,{csrf:crypto.randomBytes(24).toString('hex'),expires:clock()+20*60000,oauth:null});
      res.setHeader('set-cookie','__Host-stage='+key+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1200');redirect(res,'/stage');return true;
    }
    if(!session){page(res,401,'<form method="post" action="/stage/login"><label>Staging password <input type="password" name="password" required autocomplete="current-password"></label><button>Sign in</button></form>');return true;}
    if(req.method==='POST'){
      const body=await form(req);if(req.headers.origin!==origin||!equal(body.get('csrf'),session.csrf)){page(res,403,'<p>Request verification failed.</p>');return true;}
      if(route==='/stage/logout'){sessions.delete(id);res.setHeader('set-cookie','__Host-stage=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');redirect(res,'/stage');return true;}
      if(route==='/stage/fyers/connect'){
        if(!configured){page(res,503,'<p>FYERS application credentials are not configured.</p>');return true;}
        if(!flat()){page(res,409,'<p>Both shadow strategies must be disabled and flat before reconnecting.</p>');return true;}
        session.oauth={state:crypto.randomBytes(32).toString('hex'),expires:clock()+10*60000};
        const target=new URL('https://api-t1.fyers.in/api/v3/generate-authcode');for(const [key,value] of Object.entries({client_id:appId,redirect_uri:callback,response_type:'code',state:session.oauth.state}))target.searchParams.set(key,value);
        redirect(res,target.toString());return true;
      }
      if(route==='/stage/control'){
        const strategy=body.get('strategy');if(!['current','hams'].includes(strategy)){page(res,422,'<p>Unknown strategy.</p>');return true;}
        if(body.get('enabled')==='true'&&!ready()){page(res,409,'<p>Fresh live feed and verified signal configuration are required before arming.</p>');return true;}
        getEngine().control(strategy,{enabled:body.get('enabled')==='true',id:crypto.randomUUID()});redirect(res,'/stage');return true;
      }
    }
    if(route==='/stage/fyers/callback'&&req.method==='GET'){
      const pending=session.oauth;
      if(!pending||pending.expires<clock()||!equal(url.searchParams.get('state'),pending.state)||!url.searchParams.get('auth_code')){page(res,403,'<p>FYERS authorization state is invalid or expired.</p>');return true;}
      session.oauth=null;
      if(!flat()){page(res,409,'<p>Shadow strategies are no longer flat and disabled.</p>');return true;}
      try{
        const response=await request('https://api-t1.fyers.in/api/v3/validate-authcode',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({grant_type:'authorization_code',appIdHash:crypto.createHash('sha256').update(appId+':'+appSecret).digest('hex'),code:url.searchParams.get('auth_code')})});
        const result=await response.json();if(!response.ok||result.s!=='ok'||typeof result.access_token!=='string'||result.access_token.length<20)throw Error('FYERS_AUTH_EXCHANGE_FAILED');
        savePrivate(sessionFile,{appId,accessToken:result.access_token,connectedAt:new Date(clock()).toISOString()});lastAuthError=null;redirect(res,'/stage?connection=saved');
      }catch{lastAuthError='FYERS_AUTH_EXCHANGE_FAILED';page(res,502,'<p>FYERS authorization exchange failed. No token was replaced.</p>');}
      return true;
    }
    if(route==='/stage'&&req.method==='GET'){
      const saved=readFyersSession(sessionFile,appId),engine=getEngine();
      const rows=['current','hams'].map(s=>{const v=engine.read(s).state;return '<tr><th>'+escape(s==='current'?'NIFTY Current':'HAMS')+'</th><td>'+escape(v.rules.status)+'</td><td><form method="post" action="/stage/control">'+input(session)+'<input type="hidden" name="strategy" value="'+s+'"><input type="hidden" name="enabled" value="'+(!v.rules.enabled)+'"><button'+(!v.rules.enabled&&!ready()?' disabled':'')+'>'+(v.rules.enabled?'Disable entries':'Enable entries')+'</button></form></td></tr>';}).join('');
      page(res,200,'<section><h2>FYERS non-trading feed</h2><p>Application credentials: '+(configured?'Configured':'Missing')+'</p><p>Local token: '+(saved?'Saved '+escape(saved.connectedAt)+' · restart test app to load':'Not connected')+'</p>'+(lastAuthError?'<p>'+escape(lastAuthError)+'</p>':'')+'<form method="post" action="/stage/fyers/connect">'+input(session)+'<button'+(!configured?' disabled':'')+'>Connect FYERS</button></form></section><section><h2>Shadow strategies</h2><table>'+rows+'</table></section><section><a href="/health">Health</a><form method="post" action="/stage/logout">'+input(session)+'<button>Sign out</button></form></section>');return true;
    }
    page(res,404,'<p>Not found.</p>');return true;
  }
  return {handle,health:()=>({adminConfigured:adminConfiguration==='READY',adminConfiguration,oauthConfigured:configured,tokenSaved:fs.existsSync(sessionFile),lastAuthError})};
}
module.exports={createStageWeb,savePrivate,readFyersSession};
