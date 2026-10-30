const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function fixture(){
 let secret='owner-a',profile=null;const commands=[];
 const db={from(){let mode='read',value,filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},maybeSingle(){return q;},insert(v){mode='insert';value=v;return q;},update(v){mode='update';value=v;return q;},then(resolve,reject){let result={data:null,error:null};const owner=filters.find(([k])=>k==='secret_hash')?.[1];
 if(mode==='read')result.data=profile?.secret_hash===owner?profile:null;
 if(mode==='insert'){if(Array.isArray(value))commands.push(...value);else if(profile)result.error={code:'23505'};else profile={...value,id:'profile-id'};}
 if(mode==='update'){const version=filters.find(([k])=>k==='raw_payload->>version')?.[1];if(profile?.secret_hash===owner&&profile.raw_payload.version===version){profile={...profile,...value};result.data=[{id:profile.id}];}else result.data=[];}
 return Promise.resolve(result).then(resolve,reject);}};return q;}};
 const file=path.resolve(__dirname,'../app/api/algo/nifty-emergency/route.ts'),m=new Module(file,module);
 m.require=id=>{if(id==='next/server')return {NextResponse:{json:(body,options={})=>({body,status:options.status??200})}};if(id.endsWith('/connection'))return {connectionSecret:async()=>secret,sameOrigin:r=>r.headers.get('origin')==='https://panel.test'};if(id.endsWith('/signalStore'))return {getServerSupabase:()=>db,hashWebhookSecret:s=>'hash-'+s};if(id.endsWith('/emergencySecurity')){const f=path.resolve(__dirname,'../app/lib/algo/emergencySecurity.ts'),n=new Module(f,module);n._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return n.exports;}return require(id);};
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 return {...m.exports,commands,owner(v){secret=v;},get profile(){return profile;}};
}
const answers=['private answer alpha','private answer beta'],questions=['First private question?','Second private question?'];
const request=body=>({headers:new Headers({origin:'https://panel.test'}),json:async()=>body});
test('emergency setup keeps hashes private and requires both answers before committing both worker commands',async()=>{
 const f=fixture();assert.equal((await f.POST(request({action:'setup',answers,questions}))).status,200);
 const publicProfile=await f.GET();assert.deepEqual(publicProfile.body,{configured:true,questions});assert.equal(JSON.stringify(f.profile).includes(answers[0]),false);
 assert.equal((await f.POST(request({action:'exit',answers:[answers[0],'wrong answer']}))).status,403);assert.equal(f.commands.length,0);
 assert.equal((await f.POST(request({action:'exit',answers}))).status,200);assert.equal(f.commands.length,2);assert.deepEqual(f.commands.map(r=>r.strategy_id),['__paper_control__','__hams_final_control__']);assert.equal(f.commands[0].secret_hash,'hash-owner-a');assert.equal(f.commands[0].raw_payload.paperControl.emergencyId,f.commands[1].raw_payload.emergencyId);assert.equal(JSON.stringify(f.commands).includes(answers[0]),false);
});
test('emergency API rejects anonymous and cross-origin calls and isolates another account',async()=>{
 const f=fixture();f.owner('');assert.equal((await f.GET()).status,401);assert.equal((await f.POST(request({action:'setup',answers,questions}))).status,401);f.owner('owner-a');await f.POST(request({action:'setup',answers,questions}));f.owner('owner-b');assert.deepEqual((await f.GET()).body,{configured:false,questions:[]});assert.equal((await f.POST(request({action:'exit',answers}))).status,400);assert.equal((await f.POST({headers:new Headers({origin:'https://evil.test'})})).status,403);assert.equal(f.commands.length,0);
});
test('five incorrect attempts impose persistent throttling and existing setup cannot be overwritten',async()=>{
 const f=fixture();await f.POST(request({action:'setup',answers,questions}));assert.equal((await f.POST(request({action:'setup',answers,questions}))).status,409);
 for(let i=0;i<5;i++)assert.equal((await f.POST(request({action:'exit',answers:['wrong alpha','wrong beta']}))).status,403);
 assert.equal((await f.POST(request({action:'exit',answers}))).status,429);assert.equal(f.commands.length,0);
});
