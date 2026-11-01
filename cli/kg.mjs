#!/usr/bin/env node
import {runAgentOnce} from './agent-worker.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, saveConfig } from './config.mjs';
import { createApi, redact } from './api.mjs';
import { summarizeJob } from './summarizer.mjs';

const help = `SYNAPSE · 지식을 연결하고 기록하는 CLI

  kg configure --site https://YOUR-SITE
  kg configure --stdin                 설정 JSON을 stdin으로 읽어 안전하게 저장
  kg search "검색어" [--json]
  kg concept add "개념 이름" [--category 분야] [--description 설명] [--alias 별칭]
  kg add --concept ID [--concept ID] --text "메모" [--url 출처]
  kg add --concept ID --file notes.md [--title 제목] [--period "2020–2024"]
  kg add --concept ID --stdin           메모 본문을 stdin으로 읽기
  kg show ID [--json]
  kg link FROM TO [--type related]
  kg summarize ID
  kg export [--file synapse.json]
  kg worker [--once] [--poll 10]

설정: KG_URL, KG_TOKEN(앱 API 토큰), KG_SITES_TOKEN(비공개 Sites 접근 토큰).
모든 명령은 --site로 사이트를 선택할 수 있습니다. --url은 기록의 출처 URL입니다.
Codex SDK 요약은 Codex 인증이 설정된 환경에서 kg worker를 실행해야 합니다.
`;

const booleanFlags = new Set(['json', 'once', 'stdin', 'help']);
const stringFlags = new Set(['site', 'concept', 'text', 'file', 'url', 'title', 'period', 'source', 'category', 'description', 'alias', 'type', 'poll', 'key']);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let literal = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--') { literal = true; continue; }
    if (literal || !value.startsWith('--')) { positional.push(value); continue; }
    const equals = value.indexOf('=');
    const key = value.slice(2, equals === -1 ? undefined : equals);
    if (booleanFlags.has(key)) {
      if (equals !== -1) throw new Error(`--${key}는 값을 받지 않습니다.`);
      flags[key] = true;
      continue;
    }
    if (!stringFlags.has(key)) throw new Error(`알 수 없는 옵션: --${key}`);
    let argument = equals === -1 ? argv[++index] : value.slice(equals + 1);
    if (argument === undefined || (equals === -1 && argument.startsWith('--'))) throw new Error(`--${key} 값을 입력하세요.`);
    if (key === 'concept' || key === 'alias') {
      (flags[key] ||= []).push(argument);
    } else {
      if (flags[key] !== undefined) throw new Error(`--${key} 옵션은 한 번만 사용할 수 있습니다.`);
      flags[key] = argument;
    }
  }
  return { positional, flags };
}

async function stdin() {
  if (process.stdin.isTTY) throw new Error('stdin 입력이 필요합니다. 파일을 리다이렉트하거나 파이프로 연결하세요.');
  let value = '';
  for await (const part of process.stdin) {
    value += part;
    if (Buffer.byteLength(value) > 2_000_000) throw new Error('stdin 입력은 2MB 이하여야 합니다.');
  }
  return value;
}

function requireId(value) {
  if (!value || value.includes('/')) throw new Error('올바른 노드 ID가 필요합니다. kg search로 확인하세요.');
  return encodeURIComponent(value);
}

function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function runWorker(api, config, flags, { summarize = summarizeJob, planner, signal } = {}) {
  const seconds = Number(flags.poll || 10);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) throw new Error('--poll은 1~300초 사이여야 합니다.');
  const workerId = `atlas-${randomUUID()}`;
  let failures = 0;
  while (!signal?.aborted) {
    let job;
    try {
      const graphed=await runAgentOnce(api,config,workerId,{planner,signal});
      if(graphed){failures=0;if(flags.once)return;continue;}
      ({ job } = await api('/jobs/claim', { method: 'POST', body: { worker_id: workerId }, signal }));
      failures = 0;
      if (job) {
        process.stderr.write(`요약 시작: ${job.concept_id} (revision ${job.revision})\n`);
        try {
          const summary = await summarize(job, { signal });
          const result = await api(`/jobs/${encodeURIComponent(job.id)}/complete`, { method: 'POST', body: { lease_token: job.lease_token, summary }, signal });
          process.stderr.write(`요약 완료: ${job.concept_id}${result.status === 'superseded' ? ' · 새 기록이 있어 다시 갱신 예정' : ''}\n`);
        } catch (error) {
          const detail = redact(error.message || 'Codex 요약 실패', config).slice(0, 1200);
          try { await api(`/jobs/${encodeURIComponent(job.id)}/fail`, { method: 'POST', body: { lease_token: job.lease_token, error: detail } }); }
          catch (failure) { process.stderr.write(`작업 실패 상태 저장 불가: ${redact(failure.message, config)}\n`); }
          if (signal?.aborted) return;
          throw new Error(`${detail}\nCodex 인증과 실행 환경을 확인하세요. 원본 기록은 보존됩니다.`);
        }
      } else if (flags.once) {
        process.stderr.write('대기 중인 요약 작업이 없습니다.\n');
      }
      if (flags.once) return;
    } catch (error) {
      if (signal?.aborted) return;
      if (flags.once) throw error;
      failures++;
      process.stderr.write(`${redact(error.message, config)}\n`);
    }
    await delay(Math.min(seconds * 1000 * 2 ** Math.min(failures, 4), 60_000), signal);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { positional: args, flags } = parseArgs(argv);
  const [command, ...rest] = args;
  if (!command || flags.help || command === 'help') {
    process.stdout.write(help);
    return;
  }
  if (command === 'configure') {
    let input = {};
    if (flags.stdin) {
      try { input = JSON.parse(await stdin()); }
      catch { throw new Error('설정 JSON을 읽을 수 없습니다. {"site":"https://…","token":"…","sitesToken":"…"} 형식을 사용하세요.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('설정은 JSON 객체여야 합니다.');
    }
    if (flags.site) input.site = flags.site;
    const path = await saveConfig(input);
    process.stdout.write(`설정을 저장했습니다: ${path}\n`);
    return;
  }
  const config = await loadConfig(flags);
  const api = createApi(config);
  switch (command) {
    case 'search': {
      const query = rest.join(' ');
      const result = await api(`/concepts?q=${encodeURIComponent(query)}`);
      if (flags.json) print(result);
      else {
        const concepts = Array.isArray(result) ? result : result.concepts || [];
        for (const concept of concepts) process.stdout.write(`${concept.id}\t${concept.title}\t${concept.category || ''}\n`);
        if (!concepts.length) process.stdout.write('검색 결과가 없습니다.\n');
      }
      break;
    }
    case 'concept': {
      if (rest[0] !== 'add' || !rest[1]) throw new Error('사용법: kg concept add "개념 이름" [--category 분야]');
      print(await api('/concepts', { method: 'POST', body: { title: rest.slice(1).join(' '), category: flags.category, description: flags.description, aliases: flags.alias || [] } }));
      break;
    }
    case 'add': {
      if (!flags.concept?.length) throw new Error('--concept 노드 ID를 입력하세요.');
      const inputs = [flags.text !== undefined, flags.file !== undefined, Boolean(flags.stdin)].filter(Boolean).length;
      if (inputs > 1) throw new Error('--text, --file, --stdin 중 하나만 선택하세요.');
      const content = flags.stdin ? await stdin() : flags.file ? await readFile(flags.file, 'utf8') : flags.text || '';
      if (!content.trim() && !flags.url) throw new Error('메모 본문 또는 출처 URL이 필요합니다.');
      print(await api('/entries', { method: 'POST', idempotencyKey: flags.key || randomUUID(), body: {
        concept_ids: [...new Set(flags.concept)], content, title: flags.title || '', url: flags.url || '',
        subject_period: flags.period || '', source: flags.source || 'cli',
      } }));
      break;
    }
    case 'show': {
      const concept = await api(`/concepts/${requireId(rest[0])}`);
      if (flags.json) print(concept);
      else {
        const item = concept.concept || concept;
        process.stdout.write(`${item.title}\n${item.id}\n\n${item.summary?.overview || item.description || '아직 요약이 없습니다.'}\n`);
        if (item.summary?.changes?.length) process.stdout.write(`\n이해의 변화\n${item.summary.changes.map(change => `• ${change}`).join('\n')}\n`);
      }
      break;
    }
    case 'link': {
      requireId(rest[0]); requireId(rest[1]);
      print(await api('/relations', { method: 'POST', body: { source_id: rest[0], target_id: rest[1], type: flags.type || 'related' } }));
      break;
    }
    case 'summarize': {
      print(await api(`/concepts/${requireId(rest[0])}/summarize`, { method: 'POST', body: {} }));
      break;
    }
    case 'export': {
      const data = await api('/export');
      if (flags.file) {
        await writeFile(flags.file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
        await import('node:fs/promises').then(({ chmod }) => chmod(flags.file, 0o600));
        process.stdout.write('지식 데이터를 내보냈습니다.\n');
      } else print(data);
      break;
    }
    case 'worker': {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try { await runWorker(api, config, flags, { signal: controller.signal }); }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      break;
    }
    default: throw new Error(`알 수 없는 명령: ${command}. kg help를 참고하세요.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${redact(error.message, { token: process.env.KG_TOKEN, sitesToken: process.env.KG_SITES_TOKEN })}\n`);
    process.exitCode = 1;
  });
}
