import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function configPath(env = process.env) {
  return env.KG_CONFIG || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'atlas', 'config.json');
}

export function validateSite(value) {
  if (!value) throw new Error('사이트 주소가 필요합니다. kg configure --site https://… 또는 KG_URL을 설정하세요.');
  let url;
  try { url = new URL(value); } catch { throw new Error('사이트 주소가 올바르지 않습니다.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('HTTPS 사이트만 사용할 수 있습니다. localhost 개발 환경은 HTTP를 허용합니다.');
  }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('사이트 주소에는 경로·쿼리·인증정보를 넣지 마세요.');
  }
  return url.origin;
}

export async function loadConfig(flags = {}, env = process.env) {
  let saved = {};
  try { saved = JSON.parse(await readFile(configPath(env), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('CLI 설정 파일을 읽을 수 없습니다.'); }
  return {
    site: validateSite(flags.site || env.KG_URL || saved.site),
    token: env.KG_TOKEN || saved.token || '',
    sitesToken: env.KG_SITES_TOKEN || saved.sitesToken || '',
  };
}

export async function saveConfig(input, env = process.env) {
  const path = configPath(env);
  let previous = {};
  try { previous = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('CLI 설정 파일을 읽을 수 없습니다.'); }
  const saved = { ...previous, ...input };
  saved.site = validateSite(saved.site);
  for (const key of Object.keys(saved)) {
    if (!['site', 'token', 'sitesToken'].includes(key)) delete saved[key];
  }
  for (const key of ['token', 'sitesToken']) {
    if (saved[key] != null && typeof saved[key] !== 'string') throw new Error('토큰은 문자열이어야 합니다.');
  }
  const parent = join(path, '..');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
  return path;
}
