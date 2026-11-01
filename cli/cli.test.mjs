import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runWorker } from './kg.mjs';
import { loadConfig, saveConfig, validateSite } from './config.mjs';
import { createApi } from './api.mjs';
import { jobPrompt, sdkEnvironment, validateSummary, summarizeJob } from './summarizer.mjs';

const job = { id: 'job1', concept_id: 'c1', revision: 1, lease_token: 'lease', concept: { id: 'c1', title: '서비스' }, entries: [{ id: 'e1', content: '독립 배포가 가능하다.', url: 'https://example.com' }], concept_catalog: [{ id: 'c1', title: '서비스' }, { id: 'c2', title: '배포' }] };
const valid = () => ({ overview: '독립 배포가 가능하다.', changes: [], terms: [{ term: '배포', definition: '서비스 배포', concept_id: 'c2', evidence_ids: ['e1'] }], features: [{ title: '독립 배포', description: '개별 배포 가능', evidence_ids: ['e1'] }], related_concept_ids: ['c2'], evidence_ids: ['e1'] });

test('parses repeated concept IDs, equals flags, and literal text', () => {
  assert.deepEqual(parseArgs(['add', '--concept', 'a', '--concept=b', '--text', '$HOME', '--', '--literal']), { positional: ['add', '--literal'], flags: { concept: ['a', 'b'], text: '$HOME' } });
  assert.throws(() => parseArgs(['add', '--text', '--json']), /값/);
  assert.throws(() => parseArgs(['add', '--unknown']), /알 수 없는 옵션/);
});

test('refuses credentials in URLs, external HTTP, and path changes', () => {
  assert.equal(validateSite('https://atlas.example/'), 'https://atlas.example');
  assert.equal(validateSite('http://localhost:4173'), 'http://localhost:4173');
  for (const value of ['http://evil.example', 'https://user:secret@atlas.example', 'https://atlas.example/path', 'https://atlas.example?token=x', 'file:///tmp/app']) assert.throws(() => validateSite(value));
});

test('saves config privately and gives environment tokens precedence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-config-test-'));
  const env = { KG_CONFIG: join(directory, 'config.json') };
  try {
    const path = await saveConfig({ site: 'https://atlas.example', token: 'stored', sitesToken: 'stored-site' }, env);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).token, 'stored');
    assert.equal((await loadConfig({}, { ...env, KG_TOKEN: 'environment' })).token, 'environment');
    assert.equal((await loadConfig({ site: 'http://localhost:9000' }, env)).site, 'http://localhost:9000');
  } finally { await rm(directory, { recursive: true }); }
});

test('API credentials stay in headers and redirects are disabled', async () => {
  let sent;
  const api = createApi({ site: 'https://atlas.example', token: 'app-secret', sitesToken: 'site-secret' }, async (url, options) => {
    sent = { url, options };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  await api('/entries', { method: 'POST', body: { content: '메모' }, idempotencyKey: 'same' });
  assert.equal(sent.url, 'https://atlas.example/api/v1/entries');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, 'Bearer app-secret');
  assert.equal(sent.options.headers['OAI-Sites-Authorization'], 'Bearer site-secret');
  assert.equal(sent.options.headers['Idempotency-Key'], 'same');
  await assert.rejects(api('//evil.example'), /경로/);
});

test('summary validator rejects fabricated sources and unrelated node IDs', () => {
  assert.equal(validateSummary(valid(), job).overview, '독립 배포가 가능하다.');
  assert.throws(() => validateSummary({ ...valid(), evidence_ids: ['invented'] }, job), /근거/);
  const invented = valid(); invented.terms[0].concept_id = 'invented';
  assert.throws(() => validateSummary(invented, job), /노드/);
  const unsourced = valid(); unsourced.features[0].evidence_ids = [];
  assert.throws(() => validateSummary(unsourced, job), /근거/);
});

test('SDK environment excludes API service tokens and prompt excludes leases', () => {
  assert.deepEqual(sdkEnvironment({ PATH: '/bin', HOME: '/tmp', KG_TOKEN: 'secret', KG_SITES_TOKEN: 'secret2', DATABASE_URL: 'secret3', OPENAI_API_KEY: 'model-key' }), { PATH: '/bin', HOME: '/tmp', OPENAI_API_KEY: 'model-key' });
  const prompt = jobPrompt(job);
  assert.ok(prompt.includes('URL은 출처 표시'));
  assert.ok(prompt.includes('독립 배포'));
  assert.ok(!prompt.includes('lease_token'));
});

test('worker completes real work through lease protocol', async () => {
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    return path === '/jobs/claim' ? { job } : {};
  };
  await runWorker(api, {}, { once: true }, { summarize: async received => { assert.equal(received.id, job.id); return valid(); } });
  assert.deepEqual(calls.map(call => call.path), ['/agent/claim', '/jobs/claim', '/jobs/job1/complete']);
  assert.equal(calls[2].options.body.lease_token, 'lease');
});

test('worker records failure without fabricating a summary', async () => {
  const calls = [];
  const api = async (path, options) => { calls.push({ path, options }); return path === '/jobs/claim' ? { job } : {}; };
  await assert.rejects(runWorker(api, { token: 'app-secret' }, { once: true }, { summarize: async () => { throw new Error('missing auth app-secret'); } }), /인증/);
  assert.deepEqual(calls.map(call => call.path), ['/agent/claim', '/jobs/claim', '/jobs/job1/fail']);
  assert.ok(!calls[2].options.body.error.includes('app-secret'));
});

test('installed SDK passes sandbox and JSON schema to an executable and parses its events', { skip: process.platform === 'win32' }, async () => {
  // Direct FD I/O also works in sandboxes that restrict Node child-process libuv stdio.
  const directory = await mkdtemp(join(tmpdir(), 'atlas-sdk-smoke-'));
  const stub = join(directory, 'codex-stub.mjs');
  const oldToken = process.env.KG_TOKEN;
  process.env.KG_TOKEN = 'sdk-must-not-inherit-this-token';
  try {
    await writeFile(stub, `#!${process.execPath}\n` + `
import assert from 'node:assert/strict';
import {readFileSync, writeSync} from 'node:fs';
const args = process.argv.slice(2);
assert.equal(args[0], 'exec');
assert.ok(args.includes('--experimental-json'));
assert.equal(args[args.indexOf('--sandbox')+1], 'read-only');
assert.ok(args.includes('approval_policy="never"'));
assert.ok(args.includes('web_search="disabled"'));
assert.ok(args.includes('sandbox_workspace_write.network_access=false'));
assert.ok(args.includes('--skip-git-repo-check'));
assert.equal(process.env.KG_TOKEN, undefined);
const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1], 'utf8'));
assert.equal(schema.properties.changes.type, 'array');
const input = readFileSync(0, 'utf8');
assert.ok(input.includes('BEGIN_UNTRUSTED_DATA'));
assert.ok(input.includes('독립 배포'));
for (const event of [
  {type:'thread.started',thread_id:'stub-thread'},
  {type:'turn.started'},
  {type:'item.completed',item:{id:'message',type:'agent_message',text:${JSON.stringify(JSON.stringify(valid()))}}},
  {type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}
]) writeSync(1, JSON.stringify(event)+'\\n');
`, { mode: 0o700 });
    assert.deepEqual(await summarizeJob(job, { codexPathOverride: stub, timeoutMs: 5000 }), valid());
  } finally {
    if (oldToken === undefined) delete process.env.KG_TOKEN; else process.env.KG_TOKEN = oldToken;
    await rm(directory, { recursive: true });
  }
});

test('installed SDK process is cancelled when summary deadline expires', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-sdk-abort-'));
  const stub = join(directory, 'codex-wait.mjs');
  try {
    await writeFile(stub, `#!${process.execPath}\nimport {readFileSync} from 'node:fs';\nreadFileSync(0,'utf8');\nsetInterval(()=>{},1000);\n`, { mode: 0o700 });
    await assert.rejects(summarizeJob(job, { codexPathOverride: stub, timeoutMs: 100 }), /abort|cancel|signal/i);
  } finally { await rm(directory, { recursive: true }); }
});
