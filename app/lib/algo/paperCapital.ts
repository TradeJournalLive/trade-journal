export type PaperCapital = { initial: number | null; balance: number | null; committed: number | null; available: number | null; equity: number | null; realized: number | null; openPnl: number | null; verified: boolean };
export function paperCapital(input: { initial: number; balance: number; position: { entry: number; quantity: number } | null; mark: number | null; fresh: boolean; verified?: boolean } | null): PaperCapital {
  const blank = { initial:null,balance:null,committed:null,available:null,equity:null,realized:null,openPnl:null,verified:false };
  if(!input||!Number.isFinite(input.initial)||input.initial<=0||!Number.isFinite(input.balance))return blank;
  const round=(n:number)=>Math.round(n*100)/100;
  if(input.verified===false)return {...blank,initial:input.initial};
  const p=input.position;
  if(p&&(!Number.isFinite(p.entry)||p.entry<=0||!Number.isSafeInteger(p.quantity)||p.quantity<=0))return {...blank,initial:input.initial};
  const committed=p?round(p.entry*p.quantity):0;
  const openPnl=p?(input.fresh&&input.mark!==null&&Number.isFinite(input.mark)&&input.mark>0?round((input.mark-p.entry)*p.quantity):null):0;
  return {initial:input.initial,balance:round(input.balance),committed,available:round(input.balance-committed),equity:openPnl===null?null:round(input.balance+openPnl),realized:round(input.balance-input.initial),openPnl,verified:true};
}
