import type { SupabaseClient } from "@supabase/supabase-js";
type Row={id:number|string;received_at?:string;signal_id?:string;raw_payload?:Record<string,any>;signal?:any};
type Entry={rows:Map<string,Row>;cursor:string;checkedAt:string;expires:number};
const entries=new Map<string,Entry>(),inflight=new Map<string,Promise<Row[]>>();
const maxEntries=48,ttl=5*60000;
const sorted=(rows:Map<string,Row>)=>structuredClone([...rows.values()].sort((a,b)=>(a.received_at??"").localeCompare(b.received_at??"")||(a.signal_id??"").localeCompare(b.signal_id??"")));
// API/reporting cache only. Execution workers and ownership checks never use it.
export async function readHistory(db:SupabaseClient,owner:string,scope:string,filters:(query:any)=>any,mutableField?:string):Promise<Row[]> {
  const key=`${process.env.NEXT_PUBLIC_SUPABASE_URL}:${owner}:${scope}`;
  const pending=inflight.get(key);if(pending)return structuredClone(await pending);
  const task=(async()=>{
    const startedAt=new Date().toISOString(),cached=entries.get(key),old=cached&&cached.expires>Date.now()?cached:undefined;
    const countResult=await filters(db.from("tradingview_signal_events").select("id",{count:"exact",head:true})).eq("secret_hash",owner);
    if(countResult.error||!Number.isSafeInteger(countResult.count)||countResult.count<0)throw Error("Unable to verify complete history count.");
    const count=countResult.count as number;
    if(old&&!mutableField&&count===old.rows.size)return sorted(old.rows);
    async function fetchRows(incremental:boolean){
      const next=incremental?new Map(old!.rows):new Map<string,Row>();
      for(let offset=0;;offset+=1000){
        let q=filters(db.from("tradingview_signal_events").select("id,received_at,signal_id,signal,raw_payload")).eq("secret_hash",owner);
        if(incremental){
          if(mutableField)q=q.or(`id.gt.${old!.cursor},${mutableField}.gte.${new Date(Date.parse(old!.checkedAt)-60000).toISOString()}`);
          else q=q.gt("id",old!.cursor);
        }
        const page=await q.order("id").range(offset,offset+999);
        if(page.error)throw Error("Unable to load complete history page.");
        for(const row of page.data??[]){if(!/^[0-9]+$/.test(String(row.id)))throw Error("Invalid history cursor.");next.set(String(row.id),row);}
        if(next.size>100000)throw Error("History exceeds the complete reporting limit.");
        if(!page.data||page.data.length<1000)break;
      }
      return next;
    }
    let rows=await fetchRows(Boolean(old&&count>=old.rows.size));
    // A transaction may commit a lower allocated ID after a newer one. Count
    // reconciliation catches that case; never silently omit its trade.
    if(rows.size<count)rows=await fetchRows(false);
    if(rows.size<count)throw Error("History count changed; retry complete reconciliation.");
    let cursor=BigInt(0);for(const id of rows.keys())if(BigInt(id)>cursor)cursor=BigInt(id);
    entries.delete(key);entries.set(key,{rows,cursor:String(cursor),checkedAt:startedAt,expires:old?.expires??Date.now()+ttl});
    while(entries.size>maxEntries)entries.delete(entries.keys().next().value!);
    return sorted(rows);
  })();
  inflight.set(key,task);
  try{return structuredClone(await task);}finally{if(inflight.get(key)===task)inflight.delete(key);}
}
