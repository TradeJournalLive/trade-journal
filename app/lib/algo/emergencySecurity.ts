import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive=promisify(scrypt);
const normalize=(value:string)=>value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
export function validEmergencyAnswers(answers:unknown):answers is [string,string] {
  return Array.isArray(answers)&&answers.length===2&&answers.every(a=>typeof a==="string"&&normalize(a).length>=8&&a.length<=256)&&normalize(answers[0])!==normalize(answers[1]);
}
export async function hashEmergencyAnswer(answer:string){
  const salt=randomBytes(16).toString("hex");
  return {salt,hash:(await derive(normalize(answer),salt,64) as Buffer).toString("hex")};
}
export async function verifyEmergencyAnswers(answers:[string,string],stored:{salt:string;hash:string}[]){
  if(stored.length!==2)return false;
  const results=await Promise.all(stored.map(async(s,i)=>{
    if(!/^[a-f0-9]{32}$/.test(s.salt)||!/^[a-f0-9]{128}$/.test(s.hash))return false;
    const actual=await derive(normalize(answers[i]),s.salt,64) as Buffer;
    return timingSafeEqual(actual,Buffer.from(s.hash,"hex"));
  }));
  return results.every(Boolean);
}
