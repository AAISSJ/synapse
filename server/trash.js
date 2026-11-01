const now=()=>new Date().toISOString(),id=()=>crypto.randomUUID().replaceAll('-','');
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export function trashStatement(db,user,kind,title,payload){const key='trash_'+id();return{id:key,statement:db.prepare('INSERT INTO trash_items (id,user_id,kind,title,payload,created_at) VALUES (?,?,?,?,?,?)').bind(key,user,kind,title,JSON.stringify(payload),now())};}
export async function conceptSnapshot(db,user,concept){
 const entries=await all(db,'SELECT e.* FROM entries e JOIN entry_concepts ec ON ec.entry_id=e.id WHERE ec.concept_id=? AND e.user_id=?',concept.id,user);
 return{concept,entries,idempotency:await all(db,'SELECT * FROM idempotency WHERE user_id=? AND entry_id IN(SELECT value FROM json_each(?))',user,JSON.stringify(entries.map(e=>e.id))),links:await all(db,'SELECT * FROM entry_concepts WHERE concept_id=?',concept.id),terms:await all(db,'SELECT * FROM concept_terms WHERE concept_id=? AND user_id=?',concept.id,user),relations:await all(db,'SELECT * FROM relations WHERE user_id=? AND (source_id=? OR target_id=?)',user,concept.id,concept.id),comparisons:await all(db,'SELECT * FROM comparisons WHERE user_id=? AND EXISTS(SELECT 1 FROM json_each(comparisons.concept_ids) WHERE value=?)',user,concept.id)};
}
const fields={idempotency:['user_id','key','request_hash','entry_id','created_at'],concepts:['id','user_id','title','aliases','category','color','x','y','description','created_at','revision','personal_notes','personal_notes_updated_at','is_major'],entries:['id','user_id','highlighted','title','content','url','recorded_at','subject_period','source'],concept_terms:['id','user_id','concept_id','name_key','term','definition','aliases','source','created_at','updated_at','highlighted','hidden'],relations:['id','user_id','source_id','target_id','type'],comparisons:['id','user_id','client_key','title','description','concept_ids','rows','created_at','updated_at','decision'],inbox_items:['id','user_id','title','content','url','status','entry_id','created_at','updated_at']};
const insert=(db,table,row)=>{const cols=fields[table];return db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON CONFLICT DO NOTHING`).bind(...cols.map(c=>row[c]??(c==='decision'?'':null)));};
const sameTable=(a,b)=>['title','description','concept_ids','rows','decision'].every(k=>(a[k]??'')===(b[k]??''));
export async function restoreTrash(db,user,trash,revisionStatements){
 const p=JSON.parse(trash.payload),writes=[],affected=new Set(),stamp=now();let skippedComparisons=0;
 const owned=async cid=>!!await db.prepare('SELECT id FROM concepts WHERE id=? AND user_id=?').bind(cid,user).first();
 const conflict=message=>{const e=new Error(message);e.status=409;throw e;};
 const addEntries=async(entries,links)=>{for(const entry of entries){if(entry.user_id!==user)conflict('복원할 기록의 소유자를 확인해주세요.');writes.push(insert(db,'entries',entry));}for(const link of links){if(link.concept_id===p.concept?.id||await owned(link.concept_id)){writes.push(db.prepare('INSERT INTO entry_concepts (entry_id,concept_id) VALUES (?,?) ON CONFLICT DO NOTHING').bind(link.entry_id,link.concept_id));affected.add(link.concept_id);}}};
 if(trash.kind==='concept'||trash.kind==='merged-concept'){
  if(await owned(p.concept.id))conflict('같은 ID의 개념이 이미 있어요.');
  writes.push(insert(db,'concepts',p.concept));await addEntries(p.entries,p.links);
  for(const term of p.terms){const occupied=await db.prepare('SELECT concept_id FROM concept_terms WHERE id=?').bind(term.id).first();writes.push(insert(db,'concept_terms',{...term,id:occupied?'term_'+id():term.id}));}
  for(const relation of p.relations){const a=relation.source_id===p.concept.id||await owned(relation.source_id),b=relation.target_id===p.concept.id||await owned(relation.target_id);if(a&&b)writes.push(insert(db,'relations',relation));}
  for(const original of p.comparisons||[]){const cids=JSON.parse(original.concept_ids);if(!(await Promise.all(cids.map(cid=>cid===p.concept.id?true:owned(cid)))).every(Boolean)){skippedComparisons++;continue;}
   const current=await db.prepare('SELECT * FROM comparisons WHERE id=? AND user_id=?').bind(original.id,user).first();
   if(!current){const key=original.client_key&&await db.prepare('SELECT id FROM comparisons WHERE user_id=? AND client_key=?').bind(user,original.client_key).first();if(key){skippedComparisons++;continue;}writes.push(insert(db,'comparisons',{...original,updated_at:stamp}));}
   else{const remaining=cids.filter(cid=>cid!==p.concept.id),rows=JSON.parse(original.rows).map(r=>({...r,cells:Object.fromEntries(Object.entries(r.cells).filter(([cid])=>cid!==p.concept.id))}));const expected={...original,concept_ids:JSON.stringify(remaining),rows:JSON.stringify(rows)};if(sameTable(current,expected)){writes.push(db.prepare('UPDATE comparisons SET concept_ids=?,rows=?,updated_at=? WHERE id=? AND user_id=? AND updated_at=?').bind(original.concept_ids,original.rows,stamp,original.id,user,current.updated_at));}else skippedComparisons++;}
  }
 }else if(trash.kind==='entry'){
  const links=[];for(const link of p.links)if(await owned(link.concept_id))links.push(link);if(!links.length)conflict('연결할 개념을 먼저 복원해주세요.');await addEntries([p.entry],links);
 }else if(trash.kind==='term'){
  if(!await owned(p.term.concept_id))conflict('이 용어의 개념을 먼저 복원해주세요.');const current=await db.prepare('SELECT * FROM concept_terms WHERE id=? AND user_id=?').bind(p.term.id,user).first();
  if(current&&!current.hidden)conflict('이 용어는 이미 복원되었거나 수정됐어요.');
  if(current){writes.push(db.prepare("UPDATE concept_terms SET hidden=0,source='manual',updated_at=? WHERE id=? AND user_id=? AND hidden=1").bind(stamp,p.term.id,user));}else writes.push(insert(db,'concept_terms',{...p.term,hidden:0,source:'manual'}));
 }else if(trash.kind==='comparison'){
  const cids=JSON.parse(p.comparison.concept_ids);if(!(await Promise.all(cids.map(owned))).every(Boolean))conflict('비교표에 연결된 개념을 먼저 복원해주세요.');const duplicate=p.comparison.client_key&&await db.prepare('SELECT id FROM comparisons WHERE user_id=? AND client_key=?').bind(user,p.comparison.client_key).first();if(duplicate)conflict('같은 비교표가 이미 있어요.');writes.push(insert(db,'comparisons',{...p.comparison,updated_at:stamp}));
 }else if(trash.kind==='inbox'){writes.push(insert(db,'inbox_items',p.item));}else conflict('복원할 수 없는 항목입니다.');
 for(const row of p.idempotency||[])if(row.user_id===user)writes.push(insert(db,'idempotency',row));
 writes.push(...revisionStatements(db,user,[...affected],stamp));writes.push(db.prepare('DELETE FROM trash_items WHERE id=? AND user_id=?').bind(trash.id,user));const guard='restore_'+id();writes.unshift(db.prepare('INSERT INTO mutation_checks (id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM trash_items WHERE id=? AND user_id=?) THEN 1 ELSE 0 END').bind(guard,trash.id,user));writes.push(db.prepare('DELETE FROM mutation_checks WHERE id=?').bind(guard));try{await db.batch(writes);}catch(e){if(String(e.message).includes('mutation_valid'))conflict('이미 복원되었거나 영구 삭제된 항목입니다.');throw e;}return{restored:true,concept_id:p.concept?.id||p.term?.concept_id||null,skipped_comparisons:skippedComparisons};
}
