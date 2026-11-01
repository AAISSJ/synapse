export const normalizeName = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '').trim();
const str=(v,max,name)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${name} 형식이 올바르지 않습니다.`);return v.trim();};
export function validateGraphPlan(raw) {
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.nodes)||raw.nodes.length<1||raw.nodes.length>40||!Array.isArray(raw.relations)||raw.relations.length>100)throw new Error('한 번에 1~40개 개념, 100개 이하 관계를 생성할 수 있습니다.');
 const keys=new Set();const nodes=raw.nodes.map(n=>{if(!n||typeof n!=='object')throw new Error('개념 형식을 확인해주세요.');const key=str(n.key,100,'key');if(keys.has(key))throw new Error('중복 개념 키입니다.');keys.add(key);if(!Array.isArray(n.aliases)||n.aliases.length>15||n.aliases.some(v=>typeof v!=='string'||v.length>200))throw new Error('별칭 형식을 확인해주세요.');return{key,title:str(n.title,200,'개념 이름'),category:str(n.category,80,'큰 주제'),description:str(n.description,3000,'개념 설명'),aliases:[...new Set(n.aliases.map(v=>v.trim()).filter(Boolean))],existing_id:n.existing_id==null?null:str(n.existing_id,100,'기존 개념')};});
 const seen=new Set();const relations=raw.relations.map(r=>{if(!r||!keys.has(r.source_key)||!keys.has(r.target_key)||r.source_key===r.target_key||!['parent_of','related','prerequisite'].includes(r.type))throw new Error('관계가 존재하는 서로 다른 개념을 가리켜야 합니다.');return{source_key:r.source_key,target_key:r.target_key,type:r.type};}).filter(r=>{const k=JSON.stringify(r);if(seen.has(k))return false;seen.add(k);return true;});
 hierarchyDepth(nodes.map(n=>n.key),relations.map(r=>({source:r.source_key,target:r.target_key,type:r.type})));
 return{message:str(raw.message,4000,'에이전트 답변'),nodes,relations};
}
export function hierarchyDepth(ids,relations) {
 const depth=new Map(ids.map(id=>[id,0])),incoming=new Map(ids.map(id=>[id,0])),out=new Map(ids.map(id=>[id,[]]));
 for(const r of relations.filter(r=>r.type==='parent_of')){if(r.source===r.target)throw new Error('상위 개념이 자기 자신일 수 없습니다.');out.get(r.source).push(r.target);incoming.set(r.target,incoming.get(r.target)+1);}
 const queue=ids.filter(id=>incoming.get(id)===0);let count=0;
 for(let i=0;i<queue.length;i++){const id=queue[i];count++;for(const child of out.get(id)){depth.set(child,Math.max(depth.get(child),depth.get(id)+1));incoming.set(child,incoming.get(child)-1);if(incoming.get(child)===0)queue.push(child);}}
 if(count!==ids.length)throw new Error('상위·하위 관계에 순환이 있습니다.');return depth;
}
