import {unified} from 'unified';import remarkParse from 'remark-parse';import remarkGfm from 'remark-gfm';import {normalizeName} from './graph-plan.mjs';
const parser=unified().use(remarkParse).use(remarkGfm);
const plain=node=>node.type==='html'?'':node.type==='image'?(node.alt||''):typeof node.value==='string'?node.value:(node.children||[]).map(plain).join('');
function markdown(cell,source){if(!cell.children.length)return'';const start=cell.children[0].position.start.offset,end=cell.children.at(-1).position.end.offset;let text=source.slice(start,end);const breaks=[];const visit=node=>{if(node.type==='html'&&/^<br\s*\/?\s*>$/i.test(node.value))breaks.push(node);for(const child of node.children||[])visit(child);};visit(cell);for(const node of breaks.sort((a,b)=>b.position.start.offset-a.position.start.offset))text=text.slice(0,node.position.start.offset-start)+'  \n'+text.slice(node.position.end.offset-start);return text.trim();}
export function parseComparisonMarkdown(input){
 if(typeof input!=='string'||input.length>100000)throw Error('마크다운은 100,000자 이내로 가져올 수 있어요.');
 let source=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();const fence=source.match(/^(`{3,}|~{3,})(?:markdown|md|text)?\s*\n([\s\S]*?)\n\1\s*$/i);if(fence)source=fence[2];
 const tree=parser.parse(source),tables=[];let heading='';
 for(const node of tree.children){if(node.type==='heading')heading=plain(node).trim();if(node.type!=='table')continue;
  const headers=node.children[0].children.map(c=>plain(c).trim());if(headers.length<3||headers.length>7)throw Error('첫 열은 비교 항목, 나머지는 2~6개 개념인 표가 필요해요.');if(headers.slice(1).some(s=>!s))throw Error('비교할 개념의 열 제목을 채워주세요.');
  const body=node.children.slice(1);if(!body.length||body.length>30)throw Error('비교 항목은 1~30행까지 가져올 수 있어요.');
  const rows=body.map((r,i)=>{if(r.children.length>headers.length)throw Error(`${i+1}번째 비교 행의 열이 너무 많아요. 내용의 | 문자는 \\|로 적어주세요.`);const label=plain(r.children[0]).trim();if(!label||label.length>120)throw Error(`${i+1}번째 비교 항목 이름은 1~120자로 적어주세요.`);const values=headers.slice(1).map((_,j)=>r.children[j+1]?markdown(r.children[j+1],source):'');if(values.some(v=>v.length>800))throw Error(`${i+1}번째 행의 셀은 각각 800자 이내로 적어주세요.`);return{label,values};});
  tables.push({title:heading.slice(0,200),columns:headers.slice(1),rows});
 }
 if(!tables.length)throw Error('마크다운 표를 찾지 못했어요. 제목 행과 | --- | 구분 행을 포함해 붙여넣어주세요.');return tables;
}
export function matchComparisonColumns(columns,concepts){return columns.map(title=>{const matches=concepts.filter(c=>[c.title,...(c.aliases||[])].some(n=>normalizeName(n)===normalizeName(title)));return matches.length===1?matches[0].id:'';});}
export function importComparisonRows(table,ids,concepts){
 if(ids.length!==table.columns.length||ids.some(id=>!concepts.some(c=>c.id===id)))throw Error('모든 열에 연결할 개념을 선택해주세요.');if(new Set(ids).size!==ids.length)throw Error('각 열에는 서로 다른 개념을 연결해주세요.');
 return{concept_ids:ids,rows:table.rows.map(r=>({id:crypto.randomUUID(),label:r.label,highlighted:false,cells:Object.fromEntries(ids.map((id,i)=>[id,r.values[i]]))}))};
}
export function serializeComparisonMarkdown(draft,concepts){
 const escape=value=>String(value??'').replace(/(\\*)\|/g,(match,slashes)=>slashes.length%2?match:slashes+'\\|').replace(/ {2}\r?\n/g,'<br>').replace(/\r?\n/g,'<br>');
 const lines=[['항목',...draft.concept_ids.map(id=>concepts.find(c=>c.id===id)?.title||'개념')],Array(draft.concept_ids.length+1).fill('---'),...draft.rows.map(r=>[r.label,...draft.concept_ids.map(id=>r.cells[id]||'')])];return lines.map(r=>'| '+r.map(escape).join(' | ')+' |').join('\n');
}
