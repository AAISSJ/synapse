// Only explicit hierarchy determines roots; related/prerequisite links do not.
export function hierarchyRoots(relations){
 const parents=new Set(),children=new Set();
 for(const r of relations){if(r.type==='parent_of'){parents.add(r.source_id);children.add(r.target_id);}else if(r.type==='part_of'){parents.add(r.target_id);children.add(r.source_id);}}
 return new Set([...parents].filter(id=>!children.has(id)));
}

export function hierarchyPeers(concepts,relations,selectedId){
 const known=new Set(concepts.map(c=>c.id)),parents=new Map(),children=new Map();
 const add=(p,c)=>{if(!known.has(p)||!known.has(c)||p===c)return;(parents.get(c)||parents.set(c,new Set()).get(c)).add(p);(children.get(p)||children.set(p,new Set()).get(p)).add(c);};
 for(const r of relations){if(r.type==='parent_of')add(r.source_id,r.target_id);else if(r.type==='part_of')add(r.target_id,r.source_id);}
 if(!known.has(selectedId))return{peer_ids:[],parent_ids:[],kind:'none'};
 const direct=[...(parents.get(selectedId)||[])],candidates=new Set();
 for(const p of direct)for(const c of children.get(p)||[])candidates.add(c);
 const excluded=new Set([selectedId]);for(const links of [parents,children]){const queue=[selectedId],seen=new Set(queue);for(let i=0;i<queue.length;i++)for(const next of links.get(queue[i])||[]){if(!seen.has(next)){seen.add(next);queue.push(next);}excluded.add(next);}}
 let kind=direct.length?'siblings':'none';if(!direct.length&&hierarchyRoots(relations).has(selectedId)){kind='roots';for(const id of hierarchyRoots(relations))if(known.has(id))candidates.add(id);}
 return{peer_ids:concepts.filter(c=>candidates.has(c.id)&&!excluded.has(c.id)).map(c=>c.id),parent_ids:direct,kind};
}
