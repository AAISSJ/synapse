export function redact(message, config) {
  let result = String(message);
  for (const secret of [config?.token, config?.sitesToken, process.env.OPENAI_API_KEY, process.env.CODEX_API_KEY]) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

export function createApi(config, fetcher = fetch) {
  if (!config.token) throw new Error('앱 API 토큰이 필요합니다. 웹앱의 API 설정에서 발급한 뒤 KG_TOKEN을 설정하세요.');
  return async (path, { method = 'GET', body, idempotencyKey, signal } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('잘못된 API 경로입니다.');
    const headers = { Accept: 'application/json', Authorization: `Bearer ${config.token}` };
    if (config.sitesToken) headers['OAI-Sites-Authorization'] = `Bearer ${config.sitesToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await fetcher(`${config.site}/api/v1${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(redact(`API 연결에 실패했습니다: ${error.message}. 비공개 사이트는 KG_SITES_TOKEN도 필요합니다.`, config));
    }
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; }
    catch {
      throw new Error(`API가 JSON을 반환하지 않았습니다 (${response.status}). 사이트 주소와 KG_SITES_TOKEN을 확인하세요.`);
    }
    if (!response.ok) {
      const detail = typeof result.error === 'string' ? result.error : result.error?.message || result.message || '요청 실패';
      throw new Error(redact(`API ${response.status}: ${detail}`, config));
    }
    return result;
  };
}
