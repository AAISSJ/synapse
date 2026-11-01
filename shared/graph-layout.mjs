// Stable, compact topic clusters. Only explicit hierarchy determines depth.
export function compactLayout(concepts, relations, aspect=1.4) {
  if (!concepts.length) return {};
  const nodes=new Map(concepts.map(c=>[c.id,c])),children=new Map(),incoming=new Set();
  for(const r of relations){let a=r.source_id,b=r.target_id;if(r.type==='part_of')[a,b]=[b,a];else if(!['parent_of','하위 개념'].includes(r.type))continue;if(!nodes.has(a)||!nodes.has(b)||a===b)continue;if(!children.has(a))children.set(a,[]);children.get(a).push(b);incoming.add(b);}
  const ordered=[...concepts].sort((a,b)=>Number(!!b.is_major)-Number(!!a.is_major)||a.title.localeCompare(b.title,'ko')||a.id.localeCompare(b.id));
  const assigned=new Set(),groups=[];
  for(const root of [...ordered.filter(c=>!incoming.has(c.id)),...ordered]){
    if(assigned.has(root.id))continue;const levels=[],queue=[[root.id,0]];assigned.add(root.id);
    for(let i=0;i<queue.length;i++){const [id,depth]=queue[i];(levels[depth]??=[]).push(id);for(const child of [...(children.get(id)||[])].sort())if(!assigned.has(child)){assigned.add(child);queue.push([child,depth+1]);}}
    groups.push(levels);
  }
  const columns=aspect<.85?2:3,cellW=340,cellH=145,gap=120;
  const blocks=groups.map(levels=>{const width=Math.min(columns,Math.max(...levels.map(l=>l.length)))*cellW;let y=60;const points={};for(const level of levels){for(let i=0;i<level.length;i++){const row=Math.floor(i/columns),count=Math.min(columns,level.length-row*columns);points[level[i]]={x:width/2+(i%columns-(count-1)/2)*cellW,y:y+row*cellH};}y+=Math.ceil(level.length/columns)*cellH+35;}return{width,height:y,points};});
  const area=blocks.reduce((sum,b)=>sum+(b.width+gap)*(b.height+gap),0),target=Math.max(...blocks.map(b=>b.width),Math.sqrt(area*Math.max(.5,Math.min(2.5,aspect))));
  const result={};let x=0,y=0,rowHeight=0;for(const b of blocks){if(x&&x+b.width>target){x=0;y+=rowHeight+gap;rowHeight=0;}for(const [id,p]of Object.entries(b.points))result[id]={x:Math.round(x+p.x),y:Math.round(y+p.y)};x+=b.width+gap;rowHeight=Math.max(rowHeight,b.height);}return result;
}
