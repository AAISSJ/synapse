export const ACTIVITY_ZONE='Asia/Seoul';
export const ACTIVITY_TYPES={entry:'기록',concept:'개념',term:'용어',comparison:'비교표'};
const formatter=new Intl.DateTimeFormat('en',{timeZone:ACTIVITY_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function learningDate(value){if(value==null||value==='')return null;const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;const p=Object.fromEntries(formatter.formatToParts(date).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
export function shiftDay(day,offset){const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
export function learningActivity(data,now=new Date()){
 const today=learningDate(now),events=[],seen=new Set(),concepts=new Map((data.concepts||[]).map(c=>[c.id,c])),inbox=data.inbox||[],filed=new Set(inbox.map(i=>i.entry_id).filter(Boolean));
 const add=(kind,id,title,time,details={})=>{const day=learningDate(time);if(!day||day>today||seen.has(kind+':'+id))return;seen.add(kind+':'+id);events.push({kind,id,title,day,time,...details});};
 for(const c of concepts.values()){if(!c.id.startsWith('concept_demo_'))add('concept',c.id,c.title,c.created_at,{concept_ids:[c.id]});for(const t of c.terms||[])if(!t.hidden&&t.source!=='summary')add('term',t.id,t.term,t.created_at,{concept_ids:[c.id],concept_title:c.title,term_id:t.id});}
 for(const e of data.entries||[])if(e.source!=='example'&&!filed.has(e.id))add('entry',e.id,e.title||'제목 없는 기록',e.recorded_at,{concept_ids:e.concept_ids||[],entry_id:e.id});
 for(const item of inbox){const entry=(data.entries||[]).find(e=>e.id===item.entry_id);add('entry','inbox:'+item.id,item.title||'빠른 기록',item.created_at,{concept_ids:entry?.concept_ids||[],entry_id:entry?.id,inbox_id:entry?null:item.id});}
 for(const c of data.comparisons||[])add('comparison',c.id,c.title,c.created_at,{concept_ids:c.concept_ids||[],comparison_id:c.id});
 events.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||a.id.localeCompare(b.id));const days=new Map();for(const e of events){if(!days.has(e.day))days.set(e.day,[]);days.get(e.day).push(e);}
 const counts=(items)=>({total:items.length,...Object.fromEntries(Object.keys(ACTIVITY_TYPES).map(k=>[k,items.filter(e=>e.kind===k).length]))});
 let streak=0,start=days.has(today)?today:shiftDay(today,-1);while(days.has(start)){streak++;start=shiftDay(start,-1);}
 let longest=0,current=0,previous=null;for(const day of [...days.keys()].sort()){current=previous&&shiftDay(previous,1)===day?current+1:1;longest=Math.max(longest,current);previous=day;}
 return{today,events,days,todayCounts:counts(days.get(today)||[]),counts,streak,longest};
}
export function learningCalendar(today,start=shiftDay(today,-364)){
 const dates=[];for(let day=start;day<=today;day=shiftDay(day,1))dates.push(day);const firstWeekday=new Date(start+'T00:00:00Z').getUTCDay(),cells=[...Array(firstWeekday).fill(null),...dates];while(cells.length%7)cells.push(null);return{dates,weeks:Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7))};
}
export function activityLevel(count){return count===0?0:count<3?1:count<8?2:count<16?3:4;}
