import {trashStatement} from './trash.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const decode=row=>{const {user_id,client_key,...rest}=row;return {...rest,concept_ids:JSON.parse(row.concept_ids),rows:JSON.parse(row.rows)};};
class InputError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const str=(v,max,label)=>{if(typeof v!=='string'||v.length>max)throw new InputError(`${label} 길이와 내용을 확인해주세요.`);return v.trim();};
export const comparisonData=decode;
export async function routeComparisons(request,db,user,path,method,readBody){
 const match=path.match(/^\/comparisons(?:\/([^/]+))?$/);if(!match)return null;
 try{
 const find=async()=>db.prepare('SELECT * FROM comparisons WHERE id=? AND user_id=?').bind(match[1],user.id).first();
 if(!match[1]&&method==='GET')return json({comparisons:(await db.prepare('SELECT * FROM comparisons WHERE user_id=? ORDER BY updated_at DESC,id').bind(user.id).all()).results.map(decode)});
 if(match[1]&&method==='GET'){const row=await find();if(!row)throw new InputError('비교표를 찾을 수 없습니다.',404);return json(decode(row));}
 if(match[1]&&method==='DELETE'){const row=await find();if(!row)throw new InputError('비교표를 찾을 수 없습니다.',404);const trash=trashStatement(db,user.id,'comparison',row.title,{comparison:row});await db.batch([trash.statement,db.prepare('DELETE FROM comparisons WHERE id=? AND user_id=?').bind(row.id,user.id)]);return json({deleted:true,trash_id:trash.id});}
 if((!match[1]&&method==='POST')||(match[1]&&method==='PATCH')){
  const current=match[1]?await find():null;if(match[1]&&!current)throw new InputError('비교표를 찾을 수 없습니다.',404);
  const body=await readBody(request),title=str(body.title,200,'제목'),description=str(body.description??'',2000,'설명');if(!title)throw new InputError('비교표 제목을 적어주세요.');
  const decision=str(body.decision??current?.decision??'',12000,'내 선택과 이유');
  const ids=body.concept_ids;if(!Array.isArray(ids)||ids.length<2||ids.length>6||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw new InputError('서로 다른 개념을 2~6개 골라주세요.');
  for(const cid of ids)if(!await db.prepare('SELECT id FROM concepts WHERE id=? AND user_id=?').bind(cid,user.id).first())throw new InputError('내 지도에 있는 개념만 비교할 수 있어요.',404);
  if(!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>30)throw new InputError('비교 항목을 1~30개 적어주세요.');
  const rowIds=new Set();const rows=body.rows.map(r=>{const id=str(r.id??crypto.randomUUID(),80,'항목 ID'),label=str(r.label,120,'비교 항목');if(!id||rowIds.has(id)||!label)throw new InputError('중복되지 않는 항목 ID와 비교 항목 이름이 필요해요.');rowIds.add(id);if(r.highlighted!==undefined&&typeof r.highlighted!=='boolean')throw new InputError('중요 표시는 boolean이어야 합니다.');if(!r.cells||typeof r.cells!=='object'||Array.isArray(r.cells)||Object.keys(r.cells).some(k=>!ids.includes(k)))throw new InputError('비교할 개념에 맞는 셀을 적어주세요.');return{id,label,highlighted:!!r.highlighted,cells:Object.fromEntries(ids.map(cid=>[cid,str(r.cells[cid]??'',800,'셀 내용')]))};});
  const key=body.client_key==null?null:str(body.client_key,200,'요청 키');
  if(current){
   if(body.expected_updated_at!==undefined&&body.expected_updated_at!==current.updated_at)throw new InputError('다른 화면에서 수정됐어요. 비교표를 다시 열어주세요.',409);
   const stamp=new Date(Math.max(Date.now(),Date.parse(current.updated_at)+1)).toISOString();const result=await db.prepare('UPDATE comparisons SET title=?,description=?,decision=?,concept_ids=?,rows=?,updated_at=? WHERE id=? AND user_id=? AND updated_at=?').bind(title,description,decision,JSON.stringify(ids),JSON.stringify(rows),stamp,current.id,user.id,current.updated_at).run();if(!result.meta.changes)throw new InputError('다른 화면에서 수정됐어요. 비교표를 다시 열어주세요.',409);return json(decode(await find()));
  }
  const existing=key?await db.prepare('SELECT * FROM comparisons WHERE user_id=? AND client_key=?').bind(user.id,key).first():null;if(existing)return json(decode(existing));
  const id='comparison_'+crypto.randomUUID().replaceAll('-',''),stamp=new Date().toISOString();
  try{await db.prepare('INSERT INTO comparisons (id,user_id,client_key,title,description,concept_ids,rows,created_at,updated_at,decision) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,user.id,key,title,description,JSON.stringify(ids),JSON.stringify(rows),stamp,stamp,decision).run();}catch(e){if(key){const repeat=await db.prepare('SELECT * FROM comparisons WHERE user_id=? AND client_key=?').bind(user.id,key).first();if(repeat)return json(decode(repeat));}throw e;}
  return json({id,title,description,decision,concept_ids:ids,rows,created_at:stamp,updated_at:stamp},201);
 }
 return json({error:{message:'지원하지 않는 요청입니다.'}},405);
 }catch(e){if(e instanceof InputError)return json({error:{code:'comparison_error',message:e.message}},e.status);throw e;}
}
