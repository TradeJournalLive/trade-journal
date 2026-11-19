import {NextResponse} from 'next/server';
import {connectionSecret} from '../../../lib/algo/connection';
import {getServerSupabase,hashWebhookSecret} from '../../../lib/algo/signalStore';
import {legacyPaperIncident,redactIncident,type PaperIncidentReport} from '../../../lib/algo/paperIncidents';
import {niftyFreshSessionAt} from '../../../lib/algo/niftyLossCycle';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, Cookie'};
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers});
export async function GET(request:Request){
  try{
    const strategy=new URL(request.url).searchParams.get('strategy');
    if(strategy!=='current'&&strategy!=='hams')return reply({error:'Unknown paper strategy.'},400);
    const secret=await connectionSecret();if(!secret)return reply({error:'Sign in and link TradingView first.'},401);
    const db=getServerSupabase();if(!db)throw Error('Reporting unavailable');const owner=hashWebhookSecret(secret);
    const reports=await db.from('tradingview_signal_events').select('report:raw_payload->incident').eq('secret_hash',owner).eq('strategy_id','__paper_incident__').like('signal_id',strategy+':%').gte('received_at',niftyFreshSessionAt).order('received_at',{ascending:false}).limit(25);
    if(reports.error)throw Error('Incident reports unavailable');
    const old=await db.from('tradingview_signal_events').select(strategy==='current'?'incidents:raw_payload->state->recoveryIncidents':'incidents:raw_payload->incidents').eq('secret_hash',owner).eq('strategy_id',strategy==='current'?'__nifty_paper_worker__':'__hams_final_worker__').eq('signal_id','state').maybeSingle();
    if(old.error)throw Error('Legacy incident history unavailable');
    const values=new Map<string,PaperIncidentReport>();
    for(const i of ((old.data as unknown as {incidents?:Record<string,any>[]} | null)?.incidents||[])){if(!Number.isFinite(Date.parse(i.at))||Date.parse(i.at)<Date.parse(niftyFreshSessionAt))continue;const report=legacyPaperIncident(strategy,i);values.set(report.id,report);}
    for(const row of reports.data||[]){const report=(row as unknown as {report:PaperIncidentReport}).report;if(report?.strategy===strategy&&report.id&&Date.parse(report.at)>=Date.parse(niftyFreshSessionAt)&&!values.has(report.id))values.set(report.id,report);}
    return reply({incidents:redactIncident([...values.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,25),[secret,process.env.SUPABASE_SERVICE_ROLE_KEY||'',process.env.ALGO_CONNECTION_ENCRYPTION_KEY||'']),limit:25,note:'Provider responsibility is only established by supporting evidence. Reporting may be delayed during an outage.'});
  }catch{return reply({error:'Incident reporting is unavailable. This is not proof that there were no incidents.'},503);}
}
