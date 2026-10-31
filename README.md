# Synapse — 나의 지식 지도

개념 사이 관계를 그래프로 탐색하고 각 개념의 메모와 링크를 시간순으로 축적하는 개인 웹앱입니다. Codex SDK 작업자가 원본을 바탕으로 현재 이해·변화·용어·특징·관련 개념을 정리합니다.

## 실행

Node.js 24+, npm, zip이 필요합니다.

```bash
npm ci
npm run build
npm run dev
```

로컬 미리보기는 `http://127.0.0.1:4173`에만 바인딩됩니다. 개발 전용 SQLite와 고정 로컬 사용자를 사용하며, 이 인증 처리는 배포 코드에 포함되지 않습니다. 운영에서는 Sites 인증과 D1을 사용합니다. 저장 데이터는 브라우저 저장소에 의존하지 않습니다.

```bash
npm test
npm run db:generate
```

`db/schema.js` 변경 후 생성된 `drizzle` 마이그레이션을 확인하고 소스와 함께 배포합니다. 이미 적용한 마이그레이션은 수정하지 않습니다.

## API와 요약

웹앱의 **API · 도구 연결**에서 CLI ZIP과 OpenAPI 명세를 확인할 수 있습니다. 자세한 연결과 Codex 작업자 실행은 [CLI_README.md](CLI_README.md)를 참고하세요. 원본 기록 저장은 즉시 완료되고, 요약은 작업자가 연결되면 비동기로 실행됩니다. 출처 URL의 본문은 자동 수집하지 않습니다.

웹/API는 Sites에 배포됩니다. 공개 사이트의 방문자는 ChatGPT 로그인 후 자신의 지도를 사용하며, 메모와 링크는 사용자별로 분리됩니다. 요약 작업자는 별도의 Codex 인증된 Node.js 환경에서 실행해야 합니다. `Dockerfile.worker`도 제공합니다. 요약 작업자 환경의 인증이나 상시 실행 서버가 준비되지 않으면 요약은 대기 상태로 유지됩니다.

## 구조

- `client/`: React 화면과 SVG 그래프
- `server/api.js`: 소유자별 저장·토큰·작업 API
- `db/`, `drizzle/`: D1 스키마·마이그레이션
- `worker/index.js`: 웹/API 배포 진입점
- `cli/`: REST CLI·Codex SDK 요약 작업자
- `tests/`: SQLite 기반 통합 테스트

API는 `/api/v1/openapi.json`, 상태 확인은 `/health`입니다. 새 사용자 데이터는 빈 상태로 시작하며 예시 지도는 사용자가 선택한 경우에만 추가됩니다.
