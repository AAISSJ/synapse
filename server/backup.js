// Owner-scoped content export. Authentication material and worker leases are excluded.
const omitted=new Set(['user_id','idempotency','lease_token','lease_until','worker_id','client_id','token','token_hash','device_code','session_hash']);
function sanitize(value){if(Array.isArray(value))return value.map(sanitize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!omitted.has(key)).map(([key,v])=>[key,sanitize(v)]));return value;}
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
export async function exportBackup(db,user,core){
 const all=async(sql)=>(await db.prepare(sql).bind(user.id).all()).results||[];
 const [images,trash,threads,requests,revisions]=await Promise.all([
 all('SELECT id,filename,mime,size,created_at FROM images WHERE user_id=? ORDER BY created_at,id'),
 all('SELECT id,kind,title,payload,created_at FROM trash_items WHERE user_id=? ORDER BY created_at,id'),
 all('SELECT id,title,created_at,updated_at FROM agent_threads WHERE user_id=? ORDER BY created_at,id'),
 all('SELECT id,thread_id,prompt,status,reply,result_json,error,attempts,created_at,updated_at FROM agent_requests WHERE user_id=? ORDER BY created_at,id'),
 all('SELECT id,concept_id,revision,payload,generated_at FROM summary_revisions WHERE user_id=? ORDER BY generated_at,id')]);
 const {jobs,...knowledge}=core;
 return {format:'synapse-content-backup',version:1,exported_at:new Date().toISOString(),...knowledge,
 images:images.map(image=>({...image,url:'/api/v1/images/'+image.id})),
 trash_items:trash.map(({payload,...item})=>({...item,payload:sanitize(parse(payload))})),
 agent_threads:threads,agent_requests:requests.map(({result_json,...request})=>({...request,result:sanitize(parse(result_json))})),
 summary_revisions:revisions.map(({payload,...revision})=>({...revision,payload:sanitize(parse(payload))})),
 backup_notes:['Image bytes must be downloaded separately using images[].url.','Login sessions, API tokens, account linking credentials, worker jobs and lease state are excluded.','Trash data is included and may contain previously deleted knowledge.']};
}
