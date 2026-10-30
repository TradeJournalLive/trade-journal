"use client";
import { useEffect, useState, type FormEvent } from "react";
import { accountFetch } from "../lib/accountFetch";
export default function NiftyEmergency(){
  const [profile,setProfile]=useState<{configured:boolean;questions:string[]}|null>(null);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [step,setStep]=useState(0),[questions,setQuestions]=useState(["",""]),[answers,setAnswers]=useState(["",""]);
  useEffect(()=>{const controller=new AbortController();void accountFetch("/api/algo/nifty-emergency",{signal:controller.signal,cache:"no-store"}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error);setProfile(b);}).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});return()=>controller.abort();},[]);
  function cancel(){setOpen(false);setStep(0);setAnswers(["",""]);setQuestions(["",""]);}
  async function submit(e:FormEvent){
    e.preventDefault();if(!profile)return;
    if(profile.configured&&step===0){setStep(1);return;}
    setBusy(true);setMessage("");
    try{
      const r=await accountFetch("/api/algo/nifty-emergency",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:profile.configured?"exit":"setup",questions,answers})});
      const b=await r.json();if(!r.ok)throw Error(b.error);
      if(!profile.configured){setProfile({configured:true,questions:[...questions]});setMessage("Security questions saved. Emergency exit is ready.");}
      else setMessage(b.message);
      cancel();
    }catch(e){setMessage(e instanceof Error?e.message:"Emergency request failed.");setAnswers(["",""]);setStep(0);}finally{setBusy(false);}
  }
  return <section className="nifty-emergency" aria-label="NIFTY emergency control">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">NIFTY emergency stop</h4><p className="text-sm">Both NIFTY strategies · paper only · BTC unchanged</p></div><button type="button" className="algo-action secondary" disabled={!profile||busy} onClick={()=>{setMessage("");setOpen(true);}}>{profile?.configured?"Emergency exit all":"Set security questions"}</button></div>
    {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
    {open&&<div role="region" aria-label={profile?.configured?"Verify emergency exit":"Set emergency security"} className="mt-4 border-t pt-4">
      <p className="mb-3 text-sm">{profile?.configured?"Stop new entries and close both NIFTY paper positions at observed market bids. Prices are not guaranteed. Workers must be online; unavailable data leaves exits pending.":"Choose two different questions and private answers of at least 8 characters. Answers are case-insensitive. Use answers that others cannot guess. Keep them in your password manager; there is no automatic reset."}</p>
      <form onSubmit={submit} className="grid gap-3">
        {[0,1].filter(i=>!profile?.configured||i===step).map(i=><div key={i} className="grid gap-2">
          {profile?.configured?<label htmlFor={`emergency-answer-${i}`}>Security question {i+1} of 2: {profile.questions[i]}</label>:<label>Security question {i+1}<input required minLength={8} maxLength={180} value={questions[i]} onChange={e=>setQuestions(v=>v.map((x,k)=>k===i?e.target.value:x))} className="block w-full rounded border p-2" /></label>}
          <input id={`emergency-answer-${i}`} type="password" autoComplete="off" aria-label={`Answer ${i+1}`} required minLength={8} maxLength={256} value={answers[i]} onChange={e=>setAnswers(v=>v.map((x,k)=>k===i?e.target.value:x))} className="w-full rounded border p-2" />
        </div>)}
        <div className="flex flex-wrap gap-2"><button disabled={busy} type="submit" className="algo-action primary">{busy?"Verifying...":!profile?.configured?"Save questions":step===0?"Next question":"Verify and stop both NIFTY strategies"}</button><button disabled={busy} type="button" className="algo-action secondary" onClick={cancel}>Cancel</button></div>
      </form>
    </div>}
  </section>;
}
