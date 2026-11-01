import { routeAgent } from './agent.js';
const PREFIX = '/api/v1';
const MAX_BODY = 180_000;
const LEASE_MS = 15 * 60 * 1000;
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const text = (value, name, max = 500, optional = false) => {
  if (value == null && optional) return '';
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) fail(400, 'invalid_input', `${name} 값을 확인해주세요.`);
  return value.trim();
};
const stringList = (value, name, max = 50) => {
  if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || x.length > 500)) fail(400, 'invalid_input', `${name}은 문자열 배열이어야 합니다.`);
  return [...new Set(value.map(x => x.trim()).filter(Boolean))];
};
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
const tokenValue = () => `kg_${[...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('')}`;
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) fail(413, 'body_too_large', '요청이 너무 큽니다.');
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'json_required', 'Content-Type: application/json이 필요합니다.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY) fail(413, 'body_too_large', '요청이 너무 큽니다.');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'invalid_json', 'JSON 형식을 확인해주세요.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json', 'JSON 객체가 필요합니다.');
  return body;
}

async function authenticate(request, db) {
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    if (!authorization.startsWith('Bearer ')) fail(401, 'unauthorized', '올바른 API 토큰이 필요합니다.');
    const token = authorization.slice(7);
    if (token.length > 200) fail(401, 'unauthorized', '올바른 API 토큰이 필요합니다.');
    const user = await first(db, 'SELECT u.* FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?', await hash(token));
    if (!user) fail(401, 'unauthorized', 'API 토큰이 유효하지 않거나 폐기되었습니다.');
    return { ...user, bearer: true };
  }
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) fail(401, 'authentication_required', 'ChatGPT로 로그인하거나 API 토큰을 사용해주세요.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    if ((origin && origin !== new URL(request.url).origin) || fetchSite === 'cross-site') fail(403, 'cross_origin_request', '다른 사이트에서 보낸 요청은 허용되지 않습니다.');
  }
  let name = request.headers.get('oai-authenticated-user-full-name') || request.headers.get('oai-authenticated-user-email') || '나의 지식';
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') { try { name = decodeURIComponent(name); } catch {} }
  await statement(db, 'INSERT INTO users (id,name,created_at,demo_loaded) VALUES (?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name', userId, name.slice(0, 300), now()).run();
  return { id: userId, name, bearer: false };
}

async function ownedConcept(db, userId, conceptId) {
  const concept = await first(db, 'SELECT * FROM concepts WHERE id=? AND user_id=?', conceptId, userId);
  if (!concept) fail(404, 'not_found', '개념을 찾을 수 없습니다.');
  return concept;
}

function conceptData(row, summary = null) {
  const { user_id, ...rest } = row;
  return { ...rest, aliases: parse(row.aliases, []), summary };
}
function entryData(row, conceptIds) {
  const { user_id, ...rest } = row;
  return { ...rest, concept_ids: conceptIds };
}
const safeJob = job => { const { user_id, lease_token, worker_id, ...rest } = job; return rest; };

async function loadData(db, user) {
  const [cs, es, links, rs, summaries, js] = await Promise.all([
    all(db, 'SELECT c.*, (SELECT COUNT(*) FROM entry_concepts ec WHERE ec.concept_id=c.id) AS entry_count FROM concepts c WHERE c.user_id=? ORDER BY c.created_at,c.id', user.id),
    all(db, 'SELECT * FROM entries WHERE user_id=? ORDER BY recorded_at DESC,id DESC', user.id),
    all(db, 'SELECT ec.* FROM entry_concepts ec JOIN entries e ON e.id=ec.entry_id WHERE e.user_id=?', user.id),
    all(db, 'SELECT id,source_id,target_id,type FROM relations WHERE user_id=?', user.id),
    all(db, 'SELECT s.* FROM summary_revisions s WHERE s.user_id=? AND s.revision=(SELECT MAX(s2.revision) FROM summary_revisions s2 WHERE s2.concept_id=s.concept_id)', user.id),
    all(db, 'SELECT * FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100', user.id),
  ]);
  const summaryMap = new Map(summaries.map(s => [s.concept_id, { ...parse(s.payload, {}), revision: s.revision, generated_at: s.generated_at }]));
  const entryLinks = new Map();
  for (const link of links) entryLinks.set(link.entry_id, [...(entryLinks.get(link.entry_id) || []), link.concept_id]);
  return { concepts: cs.map(c => conceptData(c, summaryMap.get(c.id) || null)), entries: es.map(e => entryData(e, entryLinks.get(e.id) || [])), relations: rs, jobs: js.map(safeJob), user: {name: user.name}, demo: !!(await first(db, 'SELECT demo_loaded FROM users WHERE id=?', user.id))?.demo_loaded };
}

async function conceptEntries(db, userId, conceptId) {
  const rows = await all(db, 'SELECT e.* FROM entries e JOIN entry_concepts ec ON ec.entry_id=e.id WHERE ec.concept_id=? AND e.user_id=? ORDER BY e.recorded_at DESC,e.id DESC', conceptId, userId);
  return rows.map(e => entryData(e, [conceptId]));
}

async function enqueue(db, userId, conceptId) {
  const concept = await ownedConcept(db, userId, conceptId);
  const timestamp = now();
  await statement(db, "INSERT INTO jobs (id,user_id,concept_id,revision,status,attempts,created_at,updated_at) VALUES (?,?,?,?,'pending',0,?,?) ON CONFLICT(concept_id,revision) DO UPDATE SET status=CASE WHEN jobs.status IN ('failed','superseded','succeeded') THEN 'pending' ELSE jobs.status END,attempts=CASE WHEN jobs.status IN ('failed','superseded','succeeded') THEN 0 ELSE jobs.attempts END,error=CASE WHEN jobs.status IN ('failed','superseded','succeeded') THEN NULL ELSE jobs.error END,updated_at=excluded.updated_at", id('job'), userId, conceptId, concept.revision, timestamp, timestamp).run();
  return first(db, 'SELECT * FROM jobs WHERE concept_id=? AND revision=?', conceptId, concept.revision);
}

async function createEntry(request, db, user, body) {
  const conceptIds = stringList(body.concept_ids, 'concept_ids', 20);
  if (!conceptIds.length) fail(400, 'concept_required', '기록할 개념을 선택해주세요.');
  for (const conceptId of conceptIds) await ownedConcept(db, user.id, conceptId);
  const content = text(body.content, 'content', 80_000, true);
  const title = text(body.title, 'title', 300, true);
  const url = text(body.url, 'url', 4000, true);
  if (!content && !url) fail(400, 'empty_entry', '메모나 링크를 입력해주세요.');
  if (url) { let parsed; try { parsed = new URL(url); } catch {} if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) fail(400, 'invalid_url', 'http 또는 https 링크를 입력해주세요.'); }
  const subjectPeriod = text(body.subject_period, 'subject_period', 100, true);
  const source = text(body.source ?? 'api', 'source', 100);
  const key = request.headers.get('Idempotency-Key');
  if (key && (key.length > 200 || !key.trim())) fail(400, 'invalid_idempotency_key', 'Idempotency-Key는 1~200자여야 합니다.');
  const requestHash = await hash(JSON.stringify({conceptIds: [...conceptIds].sort(), content, title, url, subjectPeriod, source}));
  const repeat = async () => {
    const saved = await first(db, 'SELECT * FROM idempotency WHERE user_id=? AND key=?', user.id, key);
    if (!saved) return null;
    if (saved.request_hash !== requestHash) fail(409, 'idempotency_conflict', '동일한 키로 다른 기록을 저장할 수 없습니다.');
    const entry = await first(db, 'SELECT * FROM entries WHERE id=? AND user_id=?', saved.entry_id, user.id);
    return {entry: entryData(entry, conceptIds), job_ids: [], repeated: true};
  };
  if (key) { const repeated = await repeat(); if (repeated) return response(repeated); }
  const entryId = id('entry'); const timestamp = now(); const statements = [];
  if (key) statements.push(statement(db, 'INSERT INTO idempotency (user_id,key,request_hash,entry_id,created_at) VALUES (?,?,?,?,?)', user.id, key, requestHash, entryId, timestamp));
  statements.push(statement(db, 'INSERT INTO entries (id,user_id,title,content,url,recorded_at,subject_period,source) VALUES (?,?,?,?,?,?,?,?)', entryId, user.id, title, content, url, timestamp, subjectPeriod, source));
  const jobIds = [];
  for (const conceptId of conceptIds) {
    const jobId = id('job'); jobIds.push(jobId);
    statements.push(statement(db, 'INSERT INTO entry_concepts (entry_id,concept_id) VALUES (?,?)', entryId, conceptId));
    statements.push(statement(db, 'UPDATE concepts SET revision=revision+1 WHERE id=? AND user_id=?', conceptId, user.id));
    statements.push(statement(db, "UPDATE jobs SET status='superseded',updated_at=? WHERE concept_id=? AND user_id=? AND status IN ('pending','running','failed')", timestamp, conceptId, user.id));
    statements.push(statement(db, "INSERT INTO jobs (id,user_id,concept_id,revision,status,attempts,created_at,updated_at) SELECT ?,user_id,id,revision,'pending',0,?,? FROM concepts WHERE id=? AND user_id=?", jobId, timestamp, timestamp, conceptId, user.id));
  }
  try { await db.batch(statements); } catch (error) { if (key) { const repeated = await repeat(); if (repeated) return response(repeated); } throw error; }
  return response({entry: {id: entryId,title,content,url,recorded_at: timestamp,subject_period: subjectPeriod,source,concept_ids: conceptIds},job_ids: jobIds}, 201);
}

async function claimJob(db, user, body) {
  const workerId = text(body.worker_id, 'worker_id', 200);
  const timestamp = now(); const token = tokenValue(); const until = new Date(Date.now() + LEASE_MS).toISOString();
  await statement(db, "UPDATE jobs SET status='failed',error='작업 제한 횟수를 초과했습니다.',updated_at=? WHERE user_id=? AND status='running' AND lease_until<? AND attempts>=3", timestamp, user.id, timestamp).run();
  const job = await first(db, "UPDATE jobs SET status='running',worker_id=?,lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT j.id FROM jobs j JOIN concepts c ON c.id=j.concept_id WHERE j.user_id=? AND j.revision=c.revision AND j.attempts<3 AND (j.status='pending' OR (j.status='running' AND j.lease_until<?)) ORDER BY j.created_at LIMIT 1) AND user_id=? RETURNING *", workerId, token, until, timestamp, user.id, timestamp, user.id);
  if (!job) return response({job: null});
  const concept = await ownedConcept(db, user.id, job.concept_id);
  const [entries, catalog] = await Promise.all([conceptEntries(db, user.id, concept.id), all(db, 'SELECT id,title,aliases,description FROM concepts WHERE user_id=?', user.id)]);
  return response({job: {...safeJob(job),lease_token: token,lease_until: until,concept: conceptData(concept),entries,concept_catalog: catalog.map(c => ({...c,aliases: parse(c.aliases, [])}))}});
}

function validateSummary(raw, entryIds, conceptIds) {
  if (!raw || typeof raw !== 'object') fail(400, 'invalid_summary', 'summary 객체가 필요합니다.');
  const evidence = value => {
    const ids = stringList(value ?? [], 'evidence_ids', 1000);
    if (ids.some(x => !entryIds.has(x))) fail(400, 'invalid_evidence', '이 개념에 연결된 원본 기록만 근거로 사용할 수 있습니다.');
    return ids;
  };
  const related = stringList(raw.related_concept_ids ?? [], 'related_concept_ids', 100);
  if (related.some(x => !conceptIds.has(x))) fail(400, 'invalid_related_concept', '존재하는 내 개념만 연결할 수 있습니다.');
  if (!Array.isArray(raw.terms ?? []) || (raw.terms ?? []).length > 100 || !Array.isArray(raw.features ?? []) || (raw.features ?? []).length > 100) fail(400, 'invalid_summary', '용어와 특징 목록을 확인해주세요.');
  const terms = (raw.terms ?? []).map(term => {
    if (!term || typeof term !== 'object' || Array.isArray(term)) fail(400, 'invalid_summary', '용어 항목 형식을 확인해주세요.');
    const conceptId = term.concept_id || null;
    if (conceptId && !conceptIds.has(conceptId)) fail(400, 'invalid_related_concept', '용어의 연결 개념을 찾을 수 없습니다.');
    return {term: text(term.term, 'term', 200),definition: text(term.definition, 'definition', 3000),concept_id: conceptId,evidence_ids: evidence(term.evidence_ids)};
  });
  const features = (raw.features ?? []).map(feature => {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) fail(400, 'invalid_summary', '특징 항목 형식을 확인해주세요.');
    return {title: text(feature.title, 'feature.title', 200),description: text(feature.description, 'feature.description', 3000),evidence_ids: evidence(feature.evidence_ids)};
  });
  const summaryEvidence = evidence(raw.evidence_ids);
  if (entryIds.size && !summaryEvidence.length) fail(400, 'evidence_required', '요약에는 원본 기록 근거가 필요합니다.');
  return {overview: text(raw.overview, 'overview', 12_000),changes: stringList(raw.changes ?? [], 'changes', 50),terms,features,related_concept_ids: related,evidence_ids: summaryEvidence};
}

async function finishJob(db, user, jobId, body, complete) {
  const job = await first(db, 'SELECT * FROM jobs WHERE id=? AND user_id=?', jobId, user.id);
  if (!job) fail(404, 'not_found', '작업을 찾을 수 없습니다.');
  const timestamp = now();
  if (job.status === 'superseded') return response({status: 'superseded'});
  if (job.status !== 'running' || job.lease_token !== body.lease_token || !job.lease_until || job.lease_until <= timestamp) fail(409, 'invalid_lease', '작업 임대가 만료되었거나 유효하지 않습니다.');
  if (!complete) {
    const error = text(body.error, 'error', 2000);
    await statement(db, "UPDATE jobs SET status=CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END,error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND user_id=? AND status='running' AND lease_token=?", error, timestamp, jobId, user.id, body.lease_token).run();
    return response({job: safeJob(await first(db, 'SELECT * FROM jobs WHERE id=? AND user_id=?', jobId, user.id))});
  }
  const [entries, catalog] = await Promise.all([conceptEntries(db, user.id, job.concept_id), all(db, 'SELECT id FROM concepts WHERE user_id=?', user.id)]);
  const summary = validateSummary(body.summary, new Set(entries.map(e => e.id)), new Set(catalog.map(c => c.id)));
  await db.batch([
    statement(db, "INSERT INTO summary_revisions (id,user_id,concept_id,revision,payload,generated_at) SELECT ?,j.user_id,j.concept_id,j.revision,?,? FROM jobs j JOIN concepts c ON c.id=j.concept_id WHERE j.id=? AND j.user_id=? AND j.status='running' AND j.lease_token=? AND j.lease_until>? AND j.revision=c.revision ON CONFLICT(concept_id,revision) DO UPDATE SET payload=excluded.payload,generated_at=excluded.generated_at", id('summary'), JSON.stringify(summary), timestamp, jobId, user.id, body.lease_token, timestamp),
    statement(db, "UPDATE jobs SET status=CASE WHEN revision=(SELECT revision FROM concepts WHERE id=jobs.concept_id) THEN 'succeeded' ELSE 'superseded' END,lease_token=NULL,lease_until=NULL,error=NULL,updated_at=? WHERE id=? AND user_id=? AND status='running' AND lease_token=? AND lease_until>?", timestamp, jobId, user.id, body.lease_token, timestamp),
  ]);
  return response({status: (await first(db, 'SELECT status FROM jobs WHERE id=? AND user_id=?', jobId, user.id)).status});
}

async function seedDemo(db, user) {
  const saved = await first(db, 'SELECT demo_loaded FROM users WHERE id=?', user.id);
  if (saved?.demo_loaded) return response({loaded: false});
  const timestamp = now();
  const seedKey = (await hash(user.id)).slice(0, 24);
  const examples = [
    {title:'시스템 설계',category:'설계',description:'시스템을 구성하는 요소와 그 사이의 관계를 탐구하는 나의 지식 지도.',x:430,y:300,color:'#2d7167',note:'예시 메모: 시스템 설계를 공부할 때는 요구사항과 제약 조건을 먼저 정리하자.'},
    {title:'마이크로서비스',aliases:['MSA','Microservices'],category:'아키텍처',description:'서비스 경계와 독립적인 배포, 운영 사이의 균형을 기록하는 공간.',x:650,y:190,color:'#487e77',note:'예시 메모: 독립 배포의 이점과 분산 시스템의 운영 비용을 함께 검토해야 한다.'},
    {title:'모놀리스',aliases:['Monolith'],category:'아키텍처',description:'하나의 배포 단위 안에서 모듈을 구성하는 방식.',x:220,y:180,color:'#a28b61',note:'예시 메모: 배포 단위와 코드의 모듈 경계는 구분해서 생각할 수 있다.'},
    {title:'이벤트 기반 설계',category:'설계',description:'이벤트를 중심으로 구성 요소를 연결하는 설계에 관한 기록.',x:690,y:430,color:'#7e83a6',note:'예시 메모: 이벤트 생산자와 소비자의 결합을 낮추면 추적과 일관성 설계가 중요해진다.'},
    {title:'도메인 주도 설계',aliases:['DDD'],category:'설계',description:'도메인의 언어와 경계를 설계에 반영하는 방법.',x:440,y:520,color:'#7e83a6',note:'예시 메모: 용어의 뜻이 달라지는 경계를 발견하면 컨텍스트를 나눌 근거가 된다.'},
    {title:'CQRS',category:'데이터',description:'조회 모델과 명령 모델을 구분하는 패턴.',x:870,y:330,color:'#b78468',note:'예시 메모: CQRS와 이벤트 소싱은 함께 쓰일 수 있지만 별개의 개념이다.'},
    {title:'데이터 일관성',category:'데이터',description:'여러 구성 요소에서 데이터가 어떤 일관성을 보장하는지에 관한 기록.',x:240,y:440,color:'#b78468',note:'예시 메모: 일관성 요구사항은 사용자에게 허용되는 지연과 실패 상황에서 출발해 정리하자.'},
  ].map((c, index) => ({...c,id:`concept_demo_${seedKey}_${index}`}));
  const statements = [statement(db, 'UPDATE users SET demo_loaded=1 WHERE id=?', user.id)];
  for (const c of examples) {
    const entryId = c.id.replace('concept_', 'entry_');
    statements.push(statement(db, 'INSERT INTO concepts (id,user_id,title,aliases,category,color,x,y,description,created_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,1)', c.id,user.id,c.title,JSON.stringify(c.aliases || []),c.category,c.color,c.x,c.y,c.description,timestamp));
    statements.push(statement(db, 'INSERT INTO entries (id,user_id,title,content,url,recorded_at,subject_period,source) VALUES (?,?,?,?,?,?,?,?)', entryId,user.id,'시작을 위한 예시 기록',c.note,'',timestamp,'','example'));
    statements.push(statement(db, 'INSERT INTO entry_concepts (entry_id,concept_id) VALUES (?,?)', entryId,c.id));
  }
  for (const [from,to,type] of [[0,1,'하위 개념'],[0,2,'하위 개념'],[0,3,'하위 개념'],[0,4,'관련됨'],[1,2,'비교 대상'],[1,3,'관련됨'],[3,5,'관련됨'],[3,6,'관련됨'],[4,1,'관련됨'],[2,6,'관련됨']]) statements.push(statement(db, 'INSERT INTO relations (id,user_id,source_id,target_id,type) VALUES (?,?,?,?,?)', `relation_demo_${seedKey}_${from}_${to}`,user.id,examples[from].id,examples[to].id,type));
  try { await db.batch(statements); } catch (error) {
    if ((await first(db, 'SELECT demo_loaded FROM users WHERE id=?', user.id))?.demo_loaded) return response({loaded:false});
    throw error;
  }
  return response({loaded:true},201);
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX + '/') && url.pathname !== PREFIX) return response({error:{code:'not_found',message:'API 경로를 찾을 수 없습니다.'}},404);
  const path = url.pathname.slice(PREFIX.length).replace(/\/$/, '') || '/';
  const method = request.method;
  try {
    if (path === '/openapi.json' && method === 'GET') return response(openapi(url.origin));
    if (!env.DB) fail(503,'storage_unavailable','저장소 연결이 아직 준비되지 않았습니다.');
    const db = env.DB;
    const user = await authenticate(request, db);
    const agentResponse=await routeAgent(request,db,user,path,method,readBody);
    if(agentResponse)return agentResponse;
    if (path === '/bootstrap' && method === 'GET') return response(await loadData(db,user));
    if (path === '/export' && method === 'GET') return response({format:'atlas-knowledge-export',version:1,exported_at:now(),...await loadData(db,user)},200,{'Content-Disposition':'attachment; filename="synapse-knowledge.json"'});
    if (path === '/settings' && method === 'GET') return response({tokens:await all(db,'SELECT id,name,prefix,created_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC',user.id),worker:{engine:'codex-sdk',requires_companion:true,lease_minutes:15}});
    if (path === '/tokens' && method === 'POST') {
      if (user.bearer) fail(403,'browser_required','토큰 발급은 로그인한 웹 화면에서만 가능합니다.');
      const body = await readBody(request); const name = text(body.name,'name',100); const token = tokenValue(); const tokenId=id('token');
      await statement(db,'INSERT INTO api_tokens (id,user_id,name,token_hash,prefix,created_at) VALUES (?,?,?,?,?,?)',tokenId,user.id,name,await hash(token),token.slice(0,11),now()).run();
      return response({id:tokenId,token,name},201);
    }
    let match = path.match(/^\/tokens\/([^/]+)$/);
    if (match && method === 'DELETE') { if(user.bearer) fail(403,'browser_required','토큰 폐기는 로그인한 웹 화면에서만 가능합니다.'); await statement(db,'DELETE FROM api_tokens WHERE id=? AND user_id=?',match[1],user.id).run(); return response({deleted:true}); }
    if (path === '/concepts' && method === 'GET') {
      const data = await loadData(db,user); const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase();
      return response({concepts:data.concepts.filter(c=>!q||[c.title,...c.aliases,c.description].some(t=>t.toLocaleLowerCase().includes(q)))});
    }
    if (path === '/concepts' && method === 'POST') {
      const body=await readBody(request); const title=text(body.title,'title',200); const aliases=stringList(body.aliases??[],'aliases'); const category=text(body.category??'일반','category',80); const description=text(body.description,'description',10_000,true);
      const count=(await first(db,'SELECT COUNT(*) AS n FROM concepts WHERE user_id=?',user.id)).n;
      const angle=count*2.39996;const radius=100+Math.sqrt(count)*95; const palette=['#2c7168','#a28b61','#7e83a6','#b78468'];
      const concept={id:id('concept'),title,aliases,category,description,color:palette[count%palette.length],x:Math.round(500+Math.cos(angle)*radius),y:Math.round(350+Math.sin(angle)*radius),created_at:now(),revision:0,entry_count:0,summary:null};
      await statement(db,'INSERT INTO concepts (id,user_id,title,aliases,category,description,color,x,y,created_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,0)',concept.id,user.id,title,JSON.stringify(aliases),category,description,concept.color,concept.x,concept.y,concept.created_at).run();
      return response(concept,201);
    }
    match=path.match(/^\/concepts\/([^/]+)$/);
    if(match && method==='GET'){ const data=await loadData(db,user);const concept=data.concepts.find(c=>c.id===match[1]);if(!concept)fail(404,'not_found','개념을 찾을 수 없습니다.');return response(concept);}
    if(match && method==='PATCH'){
      const current=await ownedConcept(db,user.id,match[1]);const body=await readBody(request);
      const x=body.x??current.x,y=body.y??current.y;
      if(typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>100000||typeof y!=='number'||!Number.isFinite(y)||Math.abs(y)>100000)fail(400,'invalid_position','노드 위치를 확인해주세요.');
      const title=text(body.title??current.title,'title',200);const aliases=stringList(body.aliases??parse(current.aliases,[]),'aliases');const category=text(body.category??current.category,'category',80);const description=text(body.description??current.description,'description',10_000,true);
      await statement(db,'UPDATE concepts SET title=?,aliases=?,category=?,description=?,x=?,y=? WHERE id=? AND user_id=?',title,JSON.stringify(aliases),category,description,x,y,current.id,user.id).run();return response(conceptData({...current,title,aliases:JSON.stringify(aliases),category,description,x,y}));
    }
    match=path.match(/^\/concepts\/([^/]+)\/entries$/);
    if(match&&method==='GET'){await ownedConcept(db,user.id,match[1]);return response({entries:await conceptEntries(db,user.id,match[1])});}
    match=path.match(/^\/concepts\/([^/]+)\/summarize$/);
    if(match&&method==='POST'){await readBody(request);const job=await enqueue(db,user.id,match[1]);return response({job:safeJob(job)},202);}
    if(path==='/entries'&&method==='POST')return await createEntry(request,db,user,await readBody(request));
    if(path==='/relations'&&method==='POST'){
      const body=await readBody(request);const sourceId=text(body.source_id,'source_id',100),targetId=text(body.target_id,'target_id',100),type=text(body.type??'관련됨','type',80);
      if(sourceId===targetId)fail(400,'self_relation','서로 다른 개념을 연결해주세요.');await ownedConcept(db,user.id,sourceId);await ownedConcept(db,user.id,targetId);
      const relationId=id('relation');await statement(db,'INSERT INTO relations (id,user_id,source_id,target_id,type) VALUES (?,?,?,?,?) ON CONFLICT(user_id,source_id,target_id,type) DO NOTHING',relationId,user.id,sourceId,targetId,type).run();
      return response(await first(db,'SELECT id,source_id,target_id,type FROM relations WHERE user_id=? AND source_id=? AND target_id=? AND type=?',user.id,sourceId,targetId,type),201);
    }
    if(path==='/demo'&&method==='POST'){await readBody(request);return await seedDemo(db,user);}
    if(path==='/jobs/claim'&&method==='POST')return await claimJob(db,user,await readBody(request));
    match=path.match(/^\/jobs\/([^/]+)$/);
    if(match&&method==='GET'){const job=await first(db,'SELECT * FROM jobs WHERE id=? AND user_id=?',match[1],user.id);if(!job)fail(404,'not_found','작업을 찾을 수 없습니다.');return response({job:safeJob(job)});}
    match=path.match(/^\/jobs\/([^/]+)\/(complete|fail)$/);
    if(match&&method==='POST')return await finishJob(db,user,match[1],await readBody(request),match[2]==='complete');
    return response({error:{code:'not_found',message:'API 경로를 찾을 수 없습니다.'}},404);
  } catch(error) {
    if(error instanceof ApiError)return response({error:{code:error.code,message:error.message}},error.status);
    console.error('atlas_api_error',error?.name||'Error',error?.message?.slice(0,300));
    return response({error:{code:'internal_error',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'}},500);
  }
}

function openapi(origin) {
  const ref = name => ({$ref: `#/components/schemas/${name}`});
  const string = {type:'string'};
  const strings = {type:'array',items:string};
  const object = (properties, required = []) => ({type:'object',properties,required,additionalProperties:false});
  const schemas = {
    ConceptInput: object({title:{type:'string',minLength:1,maxLength:200},aliases:strings,category:{type:'string',maxLength:80},description:{type:'string',maxLength:10000}},['title']),
    ConceptUpdate: object({title:string,aliases:strings,category:string,description:string,x:{type:'number'},y:{type:'number'}}),
    EntryInput: object({concept_ids:{type:'array',minItems:1,maxItems:20,items:string},content:{type:'string',maxLength:80000},title:{type:'string',maxLength:300},url:{type:'string',maxLength:4000,description:'http 또는 https 링크. 링크 본문은 자동 수집하지 않습니다.'},subject_period:{type:'string',maxLength:100,description:'내용이 다루는 역사적 시기. 저장 시각과 별개입니다.'},source:{type:'string',maxLength:100,default:'api'}},['concept_ids']),
    RelationInput: object({source_id:string,target_id:string,type:{type:'string',default:'관련됨'}},['source_id','target_id']),
    Term: object({term:string,definition:string,concept_id:{type:['string','null']},evidence_ids:strings},['term','definition','evidence_ids']),
    Feature: object({title:string,description:string,evidence_ids:strings},['title','description','evidence_ids']),
    Summary: object({overview:string,changes:strings,terms:{type:'array',items:ref('Term')},features:{type:'array',items:ref('Feature')},related_concept_ids:strings,evidence_ids:strings},['overview','changes','terms','features','related_concept_ids','evidence_ids']),
    JobClaimInput: object({worker_id:string},['worker_id']),
    JobCompleteInput: object({lease_token:string,summary:ref('Summary')},['lease_token','summary']),
    JobFailInput: object({lease_token:string,error:{type:'string',maxLength:2000}},['lease_token','error']),
    AgentInput: object({prompt:{type:'string',minLength:1,maxLength:4000},client_id:{type:'string',minLength:1,maxLength:100},thread_id:string},['prompt','client_id']),
    GraphNode: object({key:string,title:string,category:string,description:string,aliases:strings,existing_id:{type:['string','null']}},['key','title','category','description','aliases']),
    GraphEdge: object({source_key:string,target_key:string,type:{type:'string',enum:['parent_of','related','prerequisite']}},['source_key','target_key','type']),
    GraphPlan: object({message:string,nodes:{type:'array',minItems:1,maxItems:40,items:ref('GraphNode')},relations:{type:'array',maxItems:100,items:ref('GraphEdge')}},['message','nodes','relations']),
    AgentCompleteInput: object({lease_token:string,plan:ref('GraphPlan')},['lease_token','plan']),
    Empty: object({}),
    Error: object({error:object({code:string,message:string},['code','message'])},['error']),
  };
  const content = schema => ({'application/json':{schema}});
  const op = (operationId, summary, input = null, status = 200) => ({operationId,summary,...(input?{requestBody:{required:true,content:content(ref(input))}}:{}),responses:{[status]:{description:'Success',content:content({type:'object'})},400:{description:'Invalid input',content:content(ref('Error'))},401:{description:'Authentication required',content:content(ref('Error'))},403:{description:'Forbidden',content:content(ref('Error'))},404:{description:'Not found',content:content(ref('Error'))},409:{description:'Conflict or expired job lease',content:content(ref('Error'))}}});
  const idParam = [{name:'id',in:'path',required:true,schema:string}];
  return {
    openapi:'3.1.0',
    info:{title:'Synapse Knowledge API',version:'1.0.0',description:'개인 지식 지도 API. 원본 기록 저장은 즉시 완료되고 Codex SDK 요약은 비동기로 처리됩니다. API 토큰은 웹 설정에서 발급합니다. 비공개 Sites에서는 플랫폼 서비스 접근 헤더도 필요합니다.'},
    servers:[{url:origin+PREFIX}],
    security:[{ApiToken:[]}],
    components:{schemas,securitySchemes:{ApiToken:{type:'http',scheme:'bearer',description:'웹 API 설정에서 발급한 kg_ 토큰'},SitesServiceAccess:{type:'apiKey',in:'header',name:'OAI-Sites-Authorization',description:'비공개 Sites 접근용 값: Bearer <Sites 서비스 토큰>'}}},
    paths:{
      '/agent/threads':{get:op('listAgentThreads','내 에이전트 대화 목록')},
      '/agent/threads/{id}':{parameters:idParam,get:op('getAgentThread','대화와 그래프 생성 상태')},
      '/agent/requests':{post:op('createAgentRequest','키워드로 그래프 구성 요청','AgentInput',202)},
      '/agent/claim':{post:op('claimAgentRequest','그래프 생성 작업 임대','JobClaimInput')},
      '/agent/requests/{id}/complete':{parameters:idParam,post:op('applyAgentGraph','검증한 노드와 관계를 한 번만 적용','AgentCompleteInput')},
      '/agent/requests/{id}/fail':{parameters:idParam,post:op('failAgentRequest','생성 실패 보고','JobFailInput')},
      '/agent/requests/{id}/retry':{parameters:idParam,post:op('retryAgentRequest','실패한 요청 재시도','Empty')},
      '/bootstrap':{get:op('getBootstrap','전체 지도와 기록 조회')},
      '/concepts':{get:{...op('searchConcepts','개념과 별칭 검색'),parameters:[{name:'q',in:'query',schema:string}]},post:op('createConcept','개념 생성','ConceptInput',201)},
      '/concepts/{id}':{parameters:idParam,get:op('getConcept','개념과 현재 요약 조회'),patch:op('updateConcept','개념과 위치 수정','ConceptUpdate')},
      '/concepts/{id}/entries':{parameters:idParam,get:op('getConceptEntries','개념의 시간순 기록')},
      '/entries':{post:{...op('createEntry','기록 추가 및 요약 작업 등록','EntryInput',201),parameters:[{name:'Idempotency-Key',in:'header',schema:{type:'string',maxLength:200},description:'같은 요청의 중복 저장 방지. 같은 키에 다른 내용은 409를 반환합니다.'}]}},
      '/relations':{post:op('createRelation','개념 연결','RelationInput',201)},
      '/concepts/{id}/summarize':{parameters:idParam,post:op('requestSummary','요약 작업 요청','Empty',202)},
      '/jobs/{id}':{parameters:idParam,get:op('getJob','작업 상태 조회')},
      '/jobs/claim':{post:op('claimJob','Codex 작업을 15분 동안 임대','JobClaimInput')},
      '/jobs/{id}/complete':{parameters:idParam,post:op('completeJob','근거가 포함된 요약 제출','JobCompleteInput')},
      '/jobs/{id}/fail':{parameters:idParam,post:op('failJob','작업 실패 보고. 최대 3회까지 재시도','JobFailInput')},
      '/export':{get:op('exportKnowledge','전체 지도와 원본 기록 JSON 내보내기')},
    },
  };
}
