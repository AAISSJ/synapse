// Only explicit hierarchy determines roots; related/prerequisite links do not.
export function hierarchyRoots(relations){
 const parents=new Set(),children=new Set();
 for(const r of relations){if(r.type==='parent_of'){parents.add(r.source_id);children.add(r.target_id);}else if(r.type==='part_of'){parents.add(r.target_id);children.add(r.source_id);}}
 return new Set([...parents].filter(id=>!children.has(id)));
}
