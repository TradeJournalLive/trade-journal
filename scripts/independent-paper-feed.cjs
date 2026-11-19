const {parse}=require('csv-parse/sync');
const {readDepth}=require('./nifty-depth.cjs');
const INDEX='NSE:NIFTY50-INDEX';
function quoteReader({contracts,onTick,required=()=>[],clock=Date.now}){
  const quotes=new Map(),depths=new Map();let spot;
  const fresh=(at,now)=>Number.isFinite(at)&&at<=now&&now-at<=5000;
  return {clear(){quotes.clear();depths.clear();spot=null;},receive(message){
    for(const r of Array.isArray(message)?message:[message]){
      if(!r?.symbol)continue;const now=clock(),at=new Date(now).toISOString();
      if(r.type==='dp'){const depth=readDepth(r,at);if(depth)depths.set(r.symbol,depth);}
      else{const time=Number(r.exch_feed_time)*1000;if(!fresh(time,now))continue;if(r.symbol===INDEX&&Number(r.ltp)>0)spot={price:Number(r.ltp),at:time};else if(Number(r.bid_price)>0&&Number(r.ask_price)>=Number(r.bid_price))quotes.set(r.symbol,{at:new Date(time).toISOString(),bid:Number(r.bid_price),ask:Number(r.ask_price),bidSize:Number(r.bid_size),askSize:Number(r.ask_size)});}
      if(!spot||!fresh(spot.at,now))continue;
      if(r.symbol!==INDEX&&!required().includes(r.symbol))continue;
      const chain=contracts().map(c=>{const q=quotes.get(c.id),d=depths.get(c.id);if(!q||!fresh(Date.parse(q.at),now))return {...c,at:'',bid:0,ask:0,bidSize:0,askSize:0};const matched=d&&fresh(Date.parse(d.depthAt),now)&&d.asks[0]?.price===q.ask&&d.bids[0]?.price===q.bid;return {...c,...q,...(matched?{...d,at:new Date(Math.max(Date.parse(q.at),Date.parse(d.depthAt))).toISOString()}:{})};});
      onTick({at,spot:spot.price,chain});
    }
  }};
}
async function startIndependentFeed({appId,accessToken,directory,onTick,onError=()=>{},required=()=>[],clock=Date.now,request=fetch,socketFactory}){
  if(!appId||!accessToken)throw Error('LOCAL_FYERS_CREDENTIALS_REQUIRED');
  const auth=appId+':'+accessToken,day=ms=>new Date(ms+330*60000).toISOString().slice(0,10);
  const masterResponse=await request('https://public.fyers.in/sym_details/NSE_FO.csv',{signal:AbortSignal.timeout(15000)});if(!masterResponse.ok)throw Error('FYERS_CONTRACT_MASTER_UNAVAILABLE');
  const master=parse(await masterResponse.text(),{skip_empty_lines:true}).filter(r=>r[13]==='NIFTY'&&['CE','PE'].includes(r[16])).map(r=>({id:r[9],expiry:day(Number(r[8])*1000),strike:Number(r[15]),side:r[16],lotSize:Number(r[3])})).filter(c=>c.expiry>=day(clock())&&c.strike>0&&Number.isSafeInteger(c.lotSize)&&c.lotSize>0);
  let contracts=[],socket,closed=false,refreshing=false;const subscribed=new Set();
  const reader=quoteReader({contracts:()=>contracts,onTick,required,clock});
  async function refresh(){if(closed||refreshing)return;refreshing=true;try{const response=await request('https://api-t1.fyers.in/data/options-chain-v3?symbol=NSE%3ANIFTY50-INDEX&strikecount=12',{headers:{Authorization:auth},signal:AbortSignal.timeout(10000)});const body=await response.json();if(!response.ok||body.s!=='ok')throw Object.assign(new Error('FYERS_OPTION_CHAIN_UNAVAILABLE'),{code:body.code||response.status});const ids=new Set([...(body.data?.optionsChain||[]).filter(r=>['CE','PE'].includes(r.option_type)).map(r=>r.symbol),...required()]);contracts=master.filter(c=>ids.has(c.id));if(!contracts.length)throw Error('FYERS_CONTRACT_SELECTION_EMPTY');if(socket?.isConnected()){const added=contracts.map(c=>c.id).filter(id=>!subscribed.has(id));if(added.length){socket.subscribe(added);socket.subscribe(added,true);added.forEach(id=>subscribed.add(id));}}}finally{refreshing=false;}}
  await refresh();
  socket=socketFactory?socketFactory(auth,directory):require('fyers-api-v3').fyersDataSocket.getInstance(auth,directory,false);
  socket.on('connect',()=>{reader.clear();subscribed.clear();const ids=contracts.map(c=>c.id);socket.subscribe([INDEX,...ids]);socket.subscribe(ids,true);ids.forEach(id=>subscribed.add(id));});
  socket.on('message',message=>{try{reader.receive(message);}catch(error){reader.clear();onError({step:'feed.processing',code:error.code||error.message||'FEED_PROCESSING_FAILED'});}});
  socket.on('close',()=>{reader.clear();onError({step:'feed.connection',code:'FYERS_SOCKET_CLOSED'});});
  socket.on('error',error=>{reader.clear();onError({step:'feed.connection',code:error?.code||'FYERS_SOCKET_ERROR'});});
  socket.connect();socket.autoreconnect?.(50);
  const timer=setInterval(()=>{void refresh().catch(error=>onError({step:'fyers.subscription.refresh',code:error.code||'FYERS_OPTION_CHAIN_UNAVAILABLE'}));},60000);timer.unref();
  return ()=>{closed=true;clearInterval(timer);socket.close?.();};
}
module.exports={quoteReader,startIndependentFeed};
