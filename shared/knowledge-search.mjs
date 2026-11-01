import {normalizeName} from './graph-plan.mjs';
// Stored definitions take precedence over generated summary definitions.
export function collectTerms(concept){
 if(!concept)return[];const map=new Map();
 for(const t of concept.terms||[]){if(!t?.term)continue;const key=normalizeName(t.term);map.set(key,{...t,id:t.id||`term:${concept.id}:${key}`,aliases:t.aliases||[],source:t.source||'manual',evidence_ids:t.evidence_ids||[]});}
 for(const t of concept.summary?.terms||[]){if(!t?.term)continue;const key=normalizeName(t.term),names=new Set([t.term,...(t.aliases||[])].map(normalizeName)),prior=[...map.values()].find(p=>[p.term,...p.aliases].some(n=>names.has(normalizeName(n))));if(prior){prior.aliases=[...new Set([...prior.aliases,...(t.aliases||[])])];prior.evidence_ids=[...new Set([...prior.evidence_ids,...(t.evidence_ids||[])])];}else map.set(key,{...t,id:`summary:${concept.id}:${key}`,aliases:t.aliases||[],source:'summary',evidence_ids:t.evidence_ids||[]});}
 return [...map.values()].filter(t=>!t.hidden);
}
export function conceptSearchText(c){return[c.title,...(c.aliases||[]),c.category,c.description,...collectTerms(c).flatMap(t=>[t.term,...t.aliases,t.definition])].filter(Boolean).join(' ');}
export function searchKnowledge(concepts,query,limit=50){
 const q=normalizeName(String(query||''));if(!q)return[];const results=[];
 const score=(title,aliases,description)=>{const name=normalizeName(title||''),other=(aliases||[]).map(normalizeName);if(name===q)return 0;if(other.includes(q))return 1;if(name.startsWith(q))return 2;if(name.includes(q)||other.some(n=>n.includes(q)))return 3;if(normalizeName(description||'').includes(q))return 5;return null;};
 for(const c of concepts){const rank=score(c.title,c.aliases,[c.description,c.category].join(' '));if(rank!==null)results.push({type:'concept',id:c.id,concept_id:c.id,concept_title:c.title,title:c.title,description:c.description||'',aliases:c.aliases||[],rank});for(const t of collectTerms(c)){const n=score(t.term,t.aliases,t.definition);if(n!==null)results.push({type:'term',id:t.id,concept_id:c.id,concept_title:c.title,title:t.term,description:t.definition||'',aliases:t.aliases,source:t.source,rank:n});}}
 return results.sort((a,b)=>a.rank-b.rank||(a.type==='concept'?-1:1)-(b.type==='concept'?-1:1)||a.title.localeCompare(b.title,'ko')).slice(0,limit).map(({rank,...rest})=>rest);
}
