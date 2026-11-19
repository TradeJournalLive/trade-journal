const {createServer}=require('node:http');
const {timingSafeEqual}=require('node:crypto');
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
function createIndependentPaperHttp({engine,webhookSecret,adminToken,allowSynthetic=false}){
  if(webhookSecret?.length<16||adminToken?.length<32||!webhookSecret||!adminToken)throw Error('PRIVATE_EXECUTION_CONFIGURATION_REQUIRED');
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    if(req.method==='GET'&&req.url==='/health')return send(200,engine.health());
    const direct=req.method==='POST'&&req.url==='/api/v1/webhooks/tradingview';
    if(!direct&&!equal(req.headers.authorization,'Bearer '+adminToken))return send(401,{error:'Unauthorized'});
    if(req.method==='GET'&&req.url==='/incidents')return send(200,{incidents:engine.store.incidents()});
    if(req.method==='GET'&&['/state/current','/state/hams'].includes(req.url))return send(200,engine.read(req.url.split('/').at(-1)));
    if(req.method!=='POST'||(!direct&&!['/control','/tick'].includes(req.url)))return send(404,{error:'Not found'});
    try{
      let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>16384)return send(413,{error:'Request too large'});parts.push(chunk);}
      const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(direct){
        if(!equal(body.secret,webhookSecret))return send(401,{error:'Unauthorized'});
        const strategy=body.metadata?.hamsFinalPaper?'hams':body.metadata?.niftyPaper?'current':null;
        if(!strategy)return send(422,{error:'Unsupported paper strategy'});
        const receipt=engine.signal(strategy,body);
        return send(202,{...receipt,mode:'SHADOW',realOrdersEnabled:false,executionComplete:false});
      }
      if(req.url==='/tick'){if(!allowSynthetic)return send(403,{error:'Synthetic input disabled'});engine.tick(body);return send(200,{processed:true});}
      if(!['current','hams'].includes(body.strategy))return send(422,{error:'Unknown strategy'});
      engine.control(body.strategy,body);return send(200,{saved:true,mode:'SHADOW'});
    }catch(error){const code=error?.code||error?.message;return send(code==='DUPLICATE_SIGNAL_CONFLICT'?409:/INVALID|STALE|UNKNOWN/.test(code)?422:503,{error:code==='DUPLICATE_SIGNAL_CONFLICT'?'Conflicting duplicate signal':code==='LOCAL_WRITER_FENCED'?'Execution ownership unavailable':'Request could not be durably accepted. Do not assume execution.'});}
  });
  server.requestTimeout=5000;server.headersTimeout=6000;
  return server;
}
module.exports={createIndependentPaperHttp};
