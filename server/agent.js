import {validateGraphPlan,normalizeName,hierarchyDepth} from '../shared/graph-plan.mjs';
const now=()=>new Date().toISOString();const id=p=>p+'_'+crypto.randomUUID().replaceAll('-','');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'입력 길이와 내용을 확인해주세요.');return v.trim();};
const stmt=(db,sql,...values)=>db.prepare(sql).bind(...values);const first=(db,sql,...v)=>stmt(db,sql,...v).first();const all=async(db,sql,...v)=>(await stmt(db,sql,...v).all()).results||[];
const parse=(v,otherwise)=>{try{return JSON.parse(v);}catch{return otherwise;}};
const safe=r=>{const {user_id,lease_token,worker_id,client_id,result_json,...rest}=r;return{...rest,result:parse(result_json,null)};};
async function owned(db,user,thread){if(!await first(db,'SELECT id FROM agent_threads WHERE id=? AND user_id=?',thread,user.id))fail(404,'대화를 찾을 수 없습니다.');}
async function submit(db,user,body){
 const prompt=text(body.prompt,4000),clientId=text(body.client_id,100);const existing=await first(db,'SELECT * FROM agent_requests WHERE user_id=? AND client_id=?',user.id,clientId);
 if(existing){if(existing.prompt!==prompt||body.thread_id&&existing.thread_id!==body.thread_id)fail(409,'같은 요청 키로 다른 대화를 보낼 수 없습니다.');return json({request:safe(existing)},200);}
 const thread=body.thread_id?text(body.thread_id,100):id('thread');if(body.thread_id)await owned(db,user,thread);
 if((await first(db,"SELECT COUNT(*) AS n FROM agent_requests WHERE user_id=? AND status IN ('pending','running')",user.id)).n>=5)fail(429,'대기 중인 요청이 많습니다. 먼저 보낸 요청을 기다려주세요.');
 const timestamp=now(),requestId=id('agent');const statements=[];
 if(!body.thread_id)statements.push(stmt(db,'INSERT INTO agent_threads (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)',thread,user.id,prompt.slice(0,60),timestamp,timestamp));
 statements.push(stmt(db,"INSERT INTO agent_requests (id,user_id,thread_id,client_id,prompt,status,reply,attempts,created_at,updated_at) VALUES (?,?,?,?,?,'pending','',0,?,?)",requestId,user.id,thread,clientId,prompt,timestamp,timestamp));
 statements.push(stmt(db,'UPDATE agent_threads SET updated_at=? WHERE id=? AND user_id=?',timestamp,thread,user.id));
 try{await db.batch(statements);}catch(e){const repeat=await first(db,'SELECT * FROM agent_requests WHERE user_id=? AND client_id=?',user.id,clientId);if(repeat&&repeat.prompt===prompt)return json({request:safe(repeat)});throw e;}
 return json({request:safe(await first(db,'SELECT * FROM agent_requests WHERE id=?',requestId))},202);
}
async function claim(db,user,body){
 const worker=text(body.worker_id,200),timestamp=now();
 await stmt(db,"UPDATE agent_requests SET status='failed',error='작업자가 응답하지 않아 종료했습니다.',updated_at=? WHERE user_id=? AND status='running' AND lease_until<? AND attempts>=3",timestamp,user.id,timestamp).run();
 // Process messages in one conversation in order, including recovered leases.
 const token=id('lease'),until=new Date(Date.now()+15*60_000).toISOString();
 const request=await first(db,"UPDATE agent_requests SET status='running',lease_token=?,worker_id=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT a.id FROM agent_requests a WHERE a.user_id=? AND a.attempts<3 AND (a.status='pending' OR (a.status='running' AND a.lease_until<?)) AND NOT EXISTS(SELECT 1 FROM agent_requests busy WHERE busy.user_id=a.user_id AND busy.id<>a.id AND busy.status='running' AND busy.lease_until>=?) AND NOT EXISTS(SELECT 1 FROM agent_requests earlier WHERE earlier.thread_id=a.thread_id AND earlier.status IN ('pending','running') AND (earlier.created_at<a.created_at OR (earlier.created_at=a.created_at AND earlier.rowid<a.rowid))) ORDER BY a.created_at,a.rowid LIMIT 1) RETURNING *",token,worker,until,timestamp,user.id,timestamp,timestamp);
 if(!request)return json({request:null});
 const [catalog,history]=await Promise.all([all(db,'SELECT id,title,aliases,category,description FROM concepts WHERE user_id=? ORDER BY created_at DESC LIMIT 500',user.id),all(db,"SELECT prompt,reply FROM agent_requests WHERE thread_id=? AND user_id=? AND status='succeeded' ORDER BY created_at DESC LIMIT 6",request.thread_id,user.id)]);
 return json({request:{...safe(request),lease_token:token,lease_until:until,catalog:catalog.map(c=>({...c,aliases:parse(c.aliases,[]).slice(0,8),description:c.description.slice(0,300)})),history:history.reverse()}});
}
async function finish(db,user,requestId,body,complete){
 const request=await first(db,'SELECT * FROM agent_requests WHERE id=? AND user_id=?',requestId,user.id);if(!request)fail(404,'요청을 찾을 수 없습니다.');
 if(request.status==='succeeded'&&complete)return json({request:safe(request),already_applied:true});
 const timestamp=now();if(request.status!=='running'||request.lease_token!==body.lease_token||request.lease_until<=timestamp)fail(409,'작업 임대가 만료되었거나 유효하지 않습니다.');
 if(!complete){await stmt(db,"UPDATE agent_requests SET status=CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END,error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND user_id=? AND status='running' AND lease_token=?",text(body.error,2000),timestamp,requestId,user.id,body.lease_token).run();return json({request:safe(await first(db,'SELECT * FROM agent_requests WHERE id=?',requestId))});}
 let plan;try{plan=validateGraphPlan(body.plan);}catch(e){fail(400,e.message);}
 const catalog=await all(db,'SELECT * FROM concepts WHERE user_id=?',user.id),byId=new Map(catalog.map(c=>[c.id,c])),names=new Map();
 for(const c of catalog)for(const n of [c.title,...parse(c.aliases,[])]){const normalized=normalizeName(n);if(!names.has(normalized))names.set(normalized,c);}
 const resolved=new Map(),records=new Map();
 for(const n of plan.nodes){
  if(n.existing_id&&!byId.has(n.existing_id))fail(400,'다른 사용자의 개념을 연결할 수 없습니다.');
  let c=n.existing_id?byId.get(n.existing_id):[n.title,...n.aliases].map(a=>names.get(normalizeName(a))).find(Boolean);
  if(!c){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user.id+'\0'+normalizeName(n.title))));const stable=[...digest].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);c={id:'concept_ai_'+stable,title:n.title,category:n.category,description:n.description,aliases:JSON.stringify(n.aliases),color:'#487e77',created_at:timestamp,isNew:true};}
  resolved.set(n.key,c.id);records.set(c.id,c);for(const name of [n.title,...n.aliases,c.title])if(!names.has(normalizeName(name)))names.set(normalizeName(name),c);
 }
 const edgeSet=new Set(),edges=[];
 for(const r of plan.relations){const edge={source:resolved.get(r.source_key),target:resolved.get(r.target_key),type:r.type};const key=JSON.stringify(edge);if(edge.source!==edge.target&&!edgeSet.has(key)){edgeSet.add(key);edges.push(edge);}}
 let depths;try{depths=hierarchyDepth([...records.keys()],edges);}catch(e){fail(400,e.message);}
 const existingHierarchy=await all(db,"SELECT source_id AS source,target_id AS target,type FROM relations WHERE user_id=? AND type='parent_of'",user.id);
 try{hierarchyDepth([...new Set([...catalog.map(c=>c.id),...records.keys()])],[...existingHierarchy,...edges]);}catch(e){fail(400,e.message);}
 const previous=Array.from(records.values()).filter(c=>!c.isNew);const centerX=previous.length?previous.reduce((s,c)=>s+c.x,0)/previous.length:Math.max(350,...catalog.map(c=>c.x))+450;
 const baseY=previous.length?Math.min(...previous.map(c=>c.y-(depths.get(c.id)||0)*170)):160;
 const levels=new Map();for(const c of records.values()){const level=depths.get(c.id)||0;if(!levels.has(level))levels.set(level,[]);levels.get(level).push(c);}
 const guard="EXISTS(SELECT 1 FROM agent_requests WHERE id=? AND user_id=? AND status='running' AND lease_token=? AND lease_until>?)";
 const g=[requestId,user.id,body.lease_token,timestamp],statements=[];
 for(const [level,list]of levels)for(let i=0;i<list.length;i++){const c=list[i],x=Math.round(centerX+(i-(list.length-1)/2)*230),y=Math.round(baseY+level*170);
  if(c.isNew)statements.push(stmt(db,`INSERT INTO concepts (id,user_id,title,aliases,category,color,x,y,description,created_at,revision) SELECT ?,?,?,?,?,?,?,?,?,?,0 WHERE ${guard} ON CONFLICT(id) DO NOTHING`,c.id,user.id,c.title,c.aliases,c.category,c.color,x,y,c.description,c.created_at,...g));
  statements.push(stmt(db,`UPDATE concepts SET x=?,y=? WHERE id=? AND user_id=? AND ${guard}`,x,y,c.id,user.id,...g));
 }
 for(const e of edges)statements.push(stmt(db,`INSERT INTO relations (id,user_id,source_id,target_id,type) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id,source_id,target_id,type) DO NOTHING`,id('relation'),user.id,e.source,e.target,e.type,...g));
 const result={concept_ids:[...records.keys()],root_ids:[...records.keys()].filter(cid=>!edges.some(e=>e.type==='parent_of'&&e.target===cid)),created:[...records.values()].filter(c=>c.isNew).length,reused:[...records.values()].filter(c=>!c.isNew).length,relations:edges.length};
 statements.push(stmt(db,`UPDATE agent_requests SET status='succeeded',reply=?,result_json=?,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND user_id=? AND ${guard}`,plan.message,JSON.stringify(result),timestamp,requestId,user.id,...g));
 statements.push(stmt(db,'UPDATE agent_threads SET updated_at=? WHERE id=? AND user_id=?',timestamp,request.thread_id,user.id));
 await db.batch(statements);return json({request:safe(await first(db,'SELECT * FROM agent_requests WHERE id=? AND user_id=?',requestId,user.id))});
}
export async function routeAgent(request,db,user,path,method,readBody){
 if(!path.startsWith('/agent/'))return null;
 try{
  if(path==='/agent/threads'&&method==='GET')return json({threads:await all(db,'SELECT id,title,created_at,updated_at FROM agent_threads WHERE user_id=? ORDER BY updated_at DESC LIMIT 30',user.id)});
  let m=path.match(/^\/agent\/threads\/([^/]+)$/);if(m&&method==='GET'){await owned(db,user,m[1]);return json({requests:(await all(db,'SELECT * FROM agent_requests WHERE thread_id=? AND user_id=? ORDER BY created_at,rowid',m[1],user.id)).map(safe)});}
  if(path==='/agent/requests'&&method==='POST')return await submit(db,user,await readBody(request));
  if(path==='/agent/claim'&&method==='POST')return await claim(db,user,await readBody(request));
  m=path.match(/^\/agent\/requests\/([^/]+)\/(complete|fail|retry)$/);if(m&&method==='POST'){const body=await readBody(request);if(m[2]==='retry'){const result=await stmt(db,"UPDATE agent_requests SET status='pending',attempts=0,error=NULL,updated_at=? WHERE id=? AND user_id=? AND status='failed' RETURNING *",now(),m[1],user.id).first();if(!result)fail(409,'실패한 요청만 다시 시도할 수 있습니다.');return json({request:safe(result)});}return await finish(db,user,m[1],body,m[2]==='complete');}
  return json({error:{code:'not_found',message:'에이전트 경로를 찾을 수 없습니다.'}},404);
 }catch(e){if(e.status)return json({error:{code:'agent_error',message:e.message}},e.status);throw e;}
}
