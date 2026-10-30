type TimingEvent = { receivedAt: string; signal: { timestamp: string; metadata?: Record<string, unknown> }; execution?: { at?: string } };
export type DeliveryTiming = {
  version: 1;
  alertFiredAt: string | null;
  fireTimeStatus: "TV_REPORTED" | "MISSING" | "INVALID";
  serverArrivedAt: string;
  serverValidatedAt: string;
};
function iso(value: unknown) {
  if(typeof value!=="string"||value.length>64||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))return null;
  const ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
export function captureDeliveryTiming(alertFiredAt:unknown,serverArrivedAt:string,serverValidatedAt:string):DeliveryTiming {
  const fired=iso(alertFiredAt);
  return {version:1,alertFiredAt:fired,fireTimeStatus:fired?"TV_REPORTED":alertFiredAt===undefined?"MISSING":"INVALID",serverArrivedAt,serverValidatedAt};
}
function delta(from:string|null,to:string|null){
  if(!from||!to)return null;const ms=Date.parse(to)-Date.parse(from);return Number.isFinite(ms)&&ms>=0?ms:null;
}
export function signalTiming(event:TimingEvent){
  const metadata=event.signal.metadata??{};
  let closedAt:string|null=null;
  for(const key of ["hamsFinalPaper","niftyPaper","btcPaper"]){
    const candle=metadata[key] as {kind?:unknown;closedAt?:unknown}|undefined;
    if(candle?.kind==="SIGNAL"&&(closedAt=iso(candle.closedAt)))break;
  }
  const saved=metadata.deliveryTiming as Partial<DeliveryTiming>|undefined;
  const arrivedAt=iso(event.receivedAt),firedAt=saved?.version===1&&saved.fireTimeStatus==="TV_REPORTED"?iso(saved.alertFiredAt):null;
  // Legacy signal.timestamp may be a bar-open time. Never silently label it as alert fire time.
  const legacyTimestampAt=!saved?iso(event.signal.timestamp):null;
  const validatedAt=saved?.version===1?iso(saved.serverValidatedAt):null;
  const orderIssue=Boolean(firedAt&&((closedAt&&Date.parse(firedAt)<Date.parse(closedAt))||(arrivedAt&&Date.parse(firedAt)>Date.parse(arrivedAt))));
  return {closedAt,firedAt,arrivedAt,validatedAt,legacyTimestampAt,
    closeToFireMs:orderIssue?null:delta(closedAt,firedAt),
    fireToArrivalMs:orderIssue?null:delta(firedAt,arrivedAt),
    validationMs:delta(arrivedAt,validatedAt),
    arrivalToDecisionMs:delta(arrivedAt,iso(event.execution?.at)),
    status:orderIssue?"CLOCK_ORDER_MISMATCH":saved?.fireTimeStatus==="INVALID"?"INVALID_FIRE_TIME":firedAt?"TV_REPORTED_SECONDS_PRECISION":legacyTimestampAt?"LEGACY_TIMESTAMP_NOT_VERIFIED":"FIRE_TIME_NOT_RECORDED"};
}
export function timingTime(value:string|null){
  return value?new Date(value).toLocaleTimeString("en-GB",{timeZone:"Asia/Kolkata",hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit",fractionalSecondDigits:3}):"--";
}
export const timingDuration=(ms:number|null)=>ms===null?"--":`${(ms/1000).toFixed(3)} s`;
