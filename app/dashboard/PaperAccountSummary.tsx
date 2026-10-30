import type { PaperCapital } from "../lib/algo/paperCapital";
const money=(n:number|null)=>n===null?"--":n.toLocaleString("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2});
export default function PaperAccountSummary({capital}:{capital:PaperCapital}) {
  return <section className="paper-account" aria-label="Paper account capital">
    <div className="paper-account-heading"><h4>Paper account</h4><span>INR · virtual funds</span></div>
    <dl className="paper-account-metrics">
      {([
        ["Starting capital",capital.initial,"initial","Original capital for the current rule session."],
        ["Account balance",capital.balance,"balance","Starting capital plus closed-trade net P&L. Open trade P&L is excluded."],
        ["Available cash",capital.available,"available","Account balance minus the premium committed to the open position."],
        ["Account equity",capital.equity,"equity","Account balance plus current open P&L, before estimated exit costs."],
      ] as const).map(([label,value,tone,title])=><div className={`paper-account-metric ${tone}`} key={label} title={title}><dt>{label}</dt><dd className={value!==null&&value<0?"negative":""}>{money(value)}</dd></div>)}
    </dl>
    <dl className="paper-account-breakdown">
      <div><dt>Premium committed</dt><dd>{money(capital.committed)}</dd></div>
      <div><dt>Realized net · current rules</dt><dd className={capital.realized===null?"":capital.realized<0?"negative":"positive"}>{money(capital.realized)}</dd></div>
      <div><dt>Open P&amp;L · before exit costs</dt><dd className={capital.openPnl===null?"":capital.openPnl<0?"negative":"positive"}>{money(capital.openPnl)}</dd></div>
    </dl>
    {!capital.verified&&<p role="status" className="paper-account-notice">Capital verification pending</p>}
  </section>;
}
