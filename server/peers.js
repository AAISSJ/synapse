import {normalizeName,hierarchyDepth} from '../shared/graph-plan.mjs';
export async function routePeers(request,db,user,path,method,readBody,{fail,response}){
 const match=path.match(/^\/concepts\/([^/]+)\/peers$/);if(!match)return null;if(method!=='POST')fail(405,'method_not_allowed','POST 요청이 필요합니다.');
 const body=await readBody(request),string=(v,max,label,optional=false)=>{if(v==null&&optional)return'';if(typeof v!=='string'||v.trim().length>max||(!optional&&!v.trim()))fail(400,'invalid_peer',label+' 값을 확인해주세요.');return v.trim();};
 const title=string(body.title,200,'개념 이름'),description=string(body.description,10000,'설명',true),key=string(body.client_key,100,'요청 식별자'),parentId=string(body.parent_id,100,'상위 개념',true),parentTitle=string(body.parent_title,200,'상위 개념 이름',true);
 if(parentTitle&&normalizeName(parentTitle)===normalizeName(title))fail(400,'invalid_peer','추가할 개념과 상위 개념의 이름을 다르게 입력해주세요.');
 if(parentId&&parentTitle)fail(400,'invalid_peer','상위 개념은 하나의 방식으로 선택해주세요.');
 const all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
 const nodes=await all('SELECT * FROM concepts WHERE user_id=?',user.id),source=nodes.find(c=>c.id===match[1]);if(!source)fail(404,'not_found','기준 개념을 찾을 수 없습니다.');
 const fingerprint=JSON.stringify({source_id:source.id,title,description,parent_id:parentId,parent_title:parentTitle});
 const readRepeat=async()=>{const row=await db.prepare('SELECT * FROM peer_additions WHERE user_id=? AND client_key=?').bind(user.id,key).first();if(!row)return null;if(row.request_body!==fingerprint)fail(409,'peer_conflict','같은 요청으로 다른 내용을 저장할 수 없습니다.');const result=JSON.parse(row.result);if(!await db.prepare('SELECT id FROM concepts WHERE id=? AND user_id=?').bind(result.peer_id,user.id).first())fail(409,'peer_removed','추가한 개념이 삭제되었습니다. 화면을 새로 열어주세요.');return {...result,repeated:true};};
 const repeated=await readRepeat();if(repeated)return response(repeated);
 const uid=p=>p+'_'+crypto.randomUUID().replaceAll('-',''),stamp=new Date().toISOString();
 const links=(await all('SELECT * FROM relations WHERE user_id=?',user.id)).filter(r=>['parent_of','part_of'].includes(r.type)).map(r=>r.type==='part_of'?{source:r.target_id,target:r.source_id,type:'parent_of'}:{source:r.source_id,target:r.target_id,type:'parent_of'});
 const currentParents=[...new Set(links.filter(r=>r.target===source.id).map(r=>r.source))];
 if(currentParents.length&&(parentId||parentTitle))fail(409,'parents_changed','기준 개념에 상위 개념이 있습니다. 화면을 다시 열어주세요.');
 const lookup=name=>{const matches=nodes.filter(c=>[c.title,...JSON.parse(c.aliases)].some(n=>normalizeName(n)===normalizeName(name)));if(matches.length>1)fail(409,'ambiguous_concept','같은 이름의 개념이 여러 개 있습니다. 이름을 구체적으로 입력해주세요.');return matches[0];};
 const newNodes=[];const make=(title,description,x,y)=>{const node={id:uid('concept'),title,description,x,y,category:source.category,color:source.color};newNodes.push(node);return node;};
 let parentIds=currentParents,parentCreated=false;
 if(!parentIds.length){let parent;if(parentId){parent=nodes.find(c=>c.id===parentId);if(!parent)fail(404,'not_found','상위 개념을 찾을 수 없습니다.');}else if(parentTitle){parent=lookup(parentTitle);if(!parent){parent=make(parentTitle,'',source.x+160,source.y-190);parentCreated=true;}}else fail(400,'parent_required','공통 상위 개념을 선택하거나 만들어주세요.');parentIds=[parent.id];}
 if(parentIds.includes(source.id))fail(400,'hierarchy_cycle','기준 개념을 자신의 상위로 지정할 수 없습니다.');
 let peer=lookup(title),created=!peer;
 if(!peer)peer=make(title,description,source.x+340,source.y);
 if(peer.id===source.id||parentIds.includes(peer.id))fail(400,'invalid_peer','기준·상위 개념과 다른 개념을 입력해주세요.');
 const reachable=(a,b)=>{const queue=[a],seen=new Set(queue);for(let i=0;i<queue.length;i++)for(const edge of links)if(edge.source===queue[i]){if(edge.target===b)return true;if(!seen.has(edge.target)){seen.add(edge.target);queue.push(edge.target);}}return false;};
 if(!created&&(reachable(source.id,peer.id)||reachable(peer.id,source.id)))fail(400,'invalid_peer','기준 개념의 상위·하위 개념은 같은 층위로 연결할 수 없습니다.');
 const additions=[...parentIds.map(parent=>({source:parent,target:peer.id,type:'parent_of'})),...(!currentParents.length?parentIds.map(parent=>({source:parent,target:source.id,type:'parent_of'})):[])];
 try{hierarchyDepth([...nodes,...newNodes].map(c=>c.id),[...links,...additions]);}catch{fail(400,'hierarchy_cycle','이 연결은 상하위 관계를 순환시킵니다. 다른 개념을 선택해주세요.');}
 const result={peer_id:peer.id,parent_ids:parentIds,created,parent_created:parentCreated};
 const writes=[db.prepare('INSERT INTO peer_additions (user_id,client_key,request_body,result,created_at) VALUES (?,?,?,?,?)').bind(user.id,key,fingerprint,JSON.stringify(result),stamp)];
 for(const n of newNodes)writes.push(db.prepare('INSERT INTO concepts (id,user_id,title,aliases,category,description,color,x,y,created_at,revision,is_major) VALUES (?,?,?,?,?,?,?,?,?,?,0,0)').bind(n.id,user.id,n.title,'[]',n.category,n.description,n.color,n.x,n.y,stamp));
 for(const r of additions)writes.push(db.prepare('INSERT INTO relations (id,user_id,source_id,target_id,type) VALUES (?,?,?,?,?) ON CONFLICT(user_id,source_id,target_id,type) DO NOTHING').bind(uid('relation'),user.id,r.source,r.target,'parent_of'));
 const check=uid('peercheck');writes.push(db.prepare(`INSERT INTO mutation_checks(id,valid) WITH RECURSIVE edges(a,b) AS (SELECT CASE WHEN type='part_of' THEN target_id ELSE source_id END,CASE WHEN type='part_of' THEN source_id ELSE target_id END FROM relations WHERE user_id=? AND type IN ('parent_of','part_of')),walk(a,b) AS (SELECT a,b FROM edges UNION SELECT walk.a,edges.b FROM walk JOIN edges ON walk.b=edges.a) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM walk WHERE a=b) THEN 0 ELSE 1 END`).bind(user.id,check),db.prepare('DELETE FROM mutation_checks WHERE id=?').bind(check));
 try{await db.batch(writes);}catch(e){const repeat=await readRepeat();if(repeat)return response(repeat);if(String(e.message).includes('mutation_valid'))fail(409,'hierarchy_changed','상하위 관계가 변경됐습니다. 새로고침 후 다시 시도해주세요.');throw e;}
 return response(result,201);
}
