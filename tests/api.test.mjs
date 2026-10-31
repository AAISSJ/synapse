import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.js';
import { createD1 } from './d1.mjs';

const ORIGIN = 'https://atlas.test';

test('OpenAPI declares every path variable for agent and CLI clients', async () => {
  const result = await handleApi(new Request(`${ORIGIN}/api/v1/openapi.json`), {});
  assert.equal(result.status, 200);
  const schema = await result.json();
  assert.equal(schema.openapi, '3.1.0');
  for (const [path, item] of Object.entries(schema.paths)) {
    const variables = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'patch', 'delete', 'put'].includes(method)) continue;
      for (const variable of variables) {
        const parameters = [...(item.parameters || []), ...(operation.parameters || [])];
        assert.ok(parameters.some(parameter => parameter.in === 'path' && parameter.name === variable && parameter.required === true), `${method} ${path} needs required ${variable}`);
      }
    }
  }
});

function harness(t) {
  const DB = createD1();
  t.after(() => DB.close());
  async function call(method, path, body, options = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (options.user !== null && !options.bearer) {
      headers.set('oai-authenticated-user-id', options.user || 'alice');
      headers.set('oai-authenticated-user-email', `${options.user || 'alice'}@example.com`);
    }
    if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
    if (options.origin !== null) headers.set('Origin', options.origin || ORIGIN);
    for (const [name, value] of Object.entries(options.headers || {})) headers.set(name, value);
    const result = await handleApi(new Request(`${ORIGIN}/api/v1${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { DB });
    return { status: result.status, headers: result.headers, body: await result.json() };
  }
  const concept = async (title = '서비스 경계', options) => {
    const result = await call('POST', '/concepts', { title, aliases: ['Service boundary'], description: '내가 정리한 설명', category: '설계' }, options);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const add = async (conceptId, content = '독립 배포에는 명확한 경계가 필요하다.', options = {}) => {
    const result = await call('POST', '/entries', { concept_ids: [conceptId], content, source: 'test' }, options);
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
    return result.body;
  };
  const summary = (entryId, overrides = {}) => ({
    overview: '원본 메모에서 서비스 경계의 중요성을 정리했다.', changes: ['배포와 경계를 함께 고려한다.'],
    terms: [{ term: '서비스 경계', definition: '독립적으로 다루는 서비스의 범위.', concept_id: null, evidence_ids: [entryId] }],
    features: [{ title: '독립 배포', description: '명확한 경계가 필요하다.', evidence_ids: [entryId] }],
    related_concept_ids: [], evidence_ids: [entryId], ...overrides,
  });
  return { DB, call, concept, add, summary };
}

test('authentication is required; personal maps are isolated and start empty', async t => {
  const { call, concept } = harness(t);
  assert.equal((await call('GET', '/bootstrap', undefined, { user: null })).status, 401);
  const empty = await call('GET', '/bootstrap');
  assert.deepEqual(empty.body.concepts, []);
  assert.deepEqual(empty.body.entries, []);
  assert.equal(empty.body.demo, false);
  const own = await concept();
  assert.equal((await call('GET', `/concepts/${own.id}`, undefined, { user: 'bob' })).status, 404);
  assert.deepEqual((await call('GET', '/bootstrap', undefined, { user: 'bob' })).body.concepts, []);
  const denied = await call('POST', '/entries', { concept_ids: [own.id], content: ' чужой ' }, { user: 'bob' });
  assert.equal(denied.status, 404);
});

test('browser writes reject cross-origin requests and malformed data without saving', async t => {
  const { call } = harness(t);
  const denied = await call('POST', '/concepts', { title: '금지된 쓰기' }, { origin: 'https://evil.example' });
  assert.equal(denied.status, 403);
  assert.equal((await call('POST', '/concepts', { title: '' })).status, 400);
  assert.equal((await call('GET', '/bootstrap')).body.concepts.length, 0);
});

test('notes preserve text, URL, subject period, aliases, and links across reads', async t => {
  const { call, concept } = harness(t);
  const first = await concept("설계'); DROP TABLE concepts; --");
  const second = await concept('도메인 주도 설계');
  const content = '<script>alert("hello")</script> SQL은 값으로 저장된다.';
  const saved = await call('POST', '/entries', {
    concept_ids: [first.id, second.id], title: '책에서 배운 점', content,
    url: 'https://example.com/design?a=1&b=2', subject_period: '2015–2019', source: 'codex',
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.job_ids.length, 2);
  const data = (await call('GET', '/bootstrap')).body;
  assert.equal(data.concepts.length, 2);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].content, content);
  assert.equal(data.entries[0].subject_period, '2015–2019');
  assert.deepEqual(new Set(data.entries[0].concept_ids), new Set([first.id, second.id]));
  assert.ok(data.concepts.every(item => item.entry_count === 1 && item.revision === 1 && item.summary === null));
  assert.equal((await call('GET', '/concepts?q=Service%20boundary')).body.concepts.length, 2);
  const related = await call('POST', '/relations', { source_id: first.id, target_id: second.id, type: '관련됨' });
  assert.equal(related.status, 201);
  assert.equal((await call('GET', '/bootstrap')).body.relations.length, 1);
  const exportResult = await call('GET', '/export');
  assert.equal(exportResult.body.format, 'atlas-knowledge-export');
  assert.equal(exportResult.body.entries[0].content, content);
  assert.match(exportResult.headers.get('content-disposition'), /attachment/);
});

test('idempotency prevents duplicate entries, including simultaneous retry and conflicting reuse', async t => {
  const { call, concept } = harness(t);
  const item = await concept();
  const body = { concept_ids: [item.id], content: '한 번만 저장할 메모', source: 'codex' };
  const options = { headers: { 'Idempotency-Key': 'capture-unique-001' } };
  const [a, b] = await Promise.all([call('POST', '/entries', body, options), call('POST', '/entries', body, options)]);
  assert.ok([200, 201].includes(a.status), JSON.stringify(a.body));
  assert.ok([200, 201].includes(b.status), JSON.stringify(b.body));
  assert.equal(a.body.entry.id, b.body.entry.id);
  const duplicate = await call('POST', '/entries', body, options);
  assert.equal(duplicate.body.entry.id, a.body.entry.id);
  const conflict = await call('POST', '/entries', { ...body, content: '다른 내용' }, options);
  assert.equal(conflict.status, 409);
  const data = (await call('GET', '/bootstrap')).body;
  assert.equal(data.entries.length, 1);
  assert.equal(data.concepts[0].revision, 1);
  assert.equal(data.jobs.length, 1);
});

test('API tokens are hashed, scoped to their owner, hidden after creation, and revocable', async t => {
  const { DB, call, concept } = harness(t);
  const item = await concept();
  const issued = await call('POST', '/tokens', { name: '노트북 Codex' });
  assert.equal(issued.status, 201);
  assert.match(issued.body.token, /^kg_[a-f0-9]{64}$/);
  const stored = DB.sqlite.prepare('SELECT * FROM api_tokens').get();
  assert.notEqual(stored.token_hash, issued.body.token);
  assert.equal(stored.token_hash.length, 64);
  const settings = (await call('GET', '/settings')).body;
  assert.equal(settings.tokens.length, 1);
  assert.equal(settings.tokens[0].token, undefined);
  assert.equal(settings.tokens[0].token_hash, undefined);
  const authenticated = await call('GET', '/bootstrap', undefined, { bearer: issued.body.token });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.concepts[0].id, item.id);
  assert.equal((await call('POST', '/tokens', { name: '추가 발급' }, { bearer: issued.body.token })).status, 403);
  assert.equal((await call('DELETE', `/tokens/${issued.body.id}`, undefined, { user: 'bob' })).status, 200);
  assert.equal((await call('GET', '/bootstrap', undefined, { bearer: issued.body.token })).status, 200);
  assert.equal((await call('DELETE', `/tokens/${issued.body.id}`)).status, 200);
  assert.equal((await call('GET', '/bootstrap', undefined, { bearer: issued.body.token })).status, 401);
});

test('job leases serialize workers, reject false evidence, and publish grounded summaries only', async t => {
  const { call, concept, add, summary } = harness(t);
  const item = await concept();
  const saved = await add(item.id);
  const claim = await call('POST', '/jobs/claim', { worker_id: 'worker-a' });
  assert.equal(claim.status, 200);
  const job = claim.body.job;
  assert.equal(job.concept_id, item.id);
  assert.equal(job.entries[0].id, saved.entry.id);
  assert.ok(job.lease_token);
  assert.equal((await call('POST', '/jobs/claim', { worker_id: 'worker-b' })).body.job, null);
  assert.equal((await call('GET', `/jobs/${job.id}`)).body.job.lease_token, undefined);
  const wrongLease = await call('POST', `/jobs/${job.id}/complete`, { lease_token: 'wrong', summary: summary(saved.entry.id) });
  assert.equal(wrongLease.status, 409);
  const foreignEvidence = await call('POST', `/jobs/${job.id}/complete`, { lease_token: job.lease_token, summary: summary('entry_not_real') });
  assert.equal(foreignEvidence.status, 400);
  assert.equal(foreignEvidence.body.error.code, 'invalid_evidence');
  const unrelated = await concept('관련 용어', { user: 'bob' });
  const foreignConcept = await call('POST', `/jobs/${job.id}/complete`, { lease_token: job.lease_token, summary: summary(saved.entry.id, { related_concept_ids: [unrelated.id] }) });
  assert.equal(foreignConcept.status, 400);
  const complete = await call('POST', `/jobs/${job.id}/complete`, { lease_token: job.lease_token, summary: summary(saved.entry.id) });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.status, 'succeeded');
  const updated = (await call('GET', `/concepts/${item.id}`)).body;
  assert.equal(updated.summary.revision, 1);
  assert.deepEqual(updated.summary.evidence_ids, [saved.entry.id]);
  assert.equal(updated.summary.terms[0].term, '서비스 경계');
  assert.equal((await call('POST', `/jobs/${job.id}/complete`, { lease_token: job.lease_token, summary: summary(saved.entry.id) })).status, 409);
});

test('new notes supersede running work and prevent old summaries replacing newer revisions', async t => {
  const { call, concept, add, summary } = harness(t);
  const item = await concept();
  const first = await add(item.id, '첫 번째 이해');
  const old = (await call('POST', '/jobs/claim', { worker_id: 'slow-worker' })).body.job;
  const second = await add(item.id, '새롭게 배운 제약');
  const late = await call('POST', `/jobs/${old.id}/complete`, { lease_token: old.lease_token, summary: summary(first.entry.id) });
  assert.equal(late.body.status, 'superseded');
  assert.equal((await call('GET', `/concepts/${item.id}`)).body.summary, null);
  const current = (await call('POST', '/jobs/claim', { worker_id: 'new-worker' })).body.job;
  assert.equal(current.revision, 2);
  assert.equal(current.entries.length, 2);
  const done = await call('POST', `/jobs/${current.id}/complete`, { lease_token: current.lease_token, summary: summary(second.entry.id) });
  assert.equal(done.body.status, 'succeeded');
  const stored = (await call('GET', `/concepts/${item.id}`)).body.summary;
  assert.equal(stored.revision, 2);
  assert.deepEqual(stored.evidence_ids, [second.entry.id]);
});

test('expired leases can be reclaimed; old workers lose their right to complete', async t => {
  const { DB, call, concept, add, summary } = harness(t);
  const item = await concept();
  const saved = await add(item.id);
  const expired = (await call('POST', '/jobs/claim', { worker_id: 'lost-worker' })).body.job;
  DB.sqlite.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.id);
  const reclaimed = (await call('POST', '/jobs/claim', { worker_id: 'replacement-worker' })).body.job;
  assert.equal(reclaimed.id, expired.id);
  assert.notEqual(reclaimed.lease_token, expired.lease_token);
  assert.equal(reclaimed.attempts, 2);
  assert.equal((await call('POST', `/jobs/${expired.id}/complete`, { lease_token: expired.lease_token, summary: summary(saved.entry.id) })).status, 409);
  const done = await call('POST', `/jobs/${reclaimed.id}/complete`, { lease_token: reclaimed.lease_token, summary: summary(saved.entry.id) });
  assert.equal(done.body.status, 'succeeded');
});

test('failures retry at most three claims, while notes remain available', async t => {
  const { call, concept, add } = harness(t);
  const item = await concept();
  const saved = await add(item.id);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const claimed = (await call('POST', '/jobs/claim', { worker_id: 'no-auth-worker' })).body.job;
    assert.equal(claimed.attempts, attempt);
    const failed = await call('POST', `/jobs/${claimed.id}/fail`, { lease_token: claimed.lease_token, error: 'Codex 인증이 필요합니다.' });
    assert.equal(failed.body.job.status, attempt < 3 ? 'pending' : 'failed');
  }
  assert.equal((await call('POST', '/jobs/claim', { worker_id: 'still-no-auth' })).body.job, null);
  assert.equal((await call('GET', `/concepts/${item.id}/entries`)).body.entries[0].id, saved.entry.id);
  const retry = await call('POST', `/concepts/${item.id}/summarize`, {});
  assert.equal(retry.status, 202);
  assert.equal(retry.body.job.status, 'pending');
});

test('example data is explicit and idempotent; it never invents AI summaries', async t => {
  const { call } = harness(t);
  assert.equal((await call('GET', '/bootstrap')).body.demo, false);
  const loaded = await call('POST', '/demo', {});
  assert.equal(loaded.status, 201);
  const data = (await call('GET', '/bootstrap')).body;
  assert.equal(data.demo, true);
  assert.ok(data.concepts.length > 3);
  assert.ok(data.entries.every(entry => entry.source === 'example'));
  assert.ok(data.concepts.every(concept => concept.summary === null));
  assert.equal((await call('POST', '/demo', {})).body.loaded, false);
  assert.equal((await call('GET', '/bootstrap')).body.concepts.length, data.concepts.length);
});
