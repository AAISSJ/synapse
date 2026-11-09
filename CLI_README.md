# Synapse CLI와 Codex SDK

Node.js 22 이상이 필요합니다. 웹앱에서 받은 CLI ZIP을 풀면 `package.json`과 `cli/` 폴더가 있습니다. 압축을 푼 폴더에서 `npm install` 후 실행합니다. 전체 소스 체크아웃에서도 같은 명령을 사용할 수 있습니다.

```bash
npm install
node cli/kg.mjs help
```

`node cli/kg.mjs`가 실제 명령이며, `npm link`를 실행하면 `kg`로도 호출할 수 있습니다. CLI는 REST API를 사용하며, 메모는 브라우저와 같은 서버 DB에 저장됩니다.

## 연결

```bash
node cli/kg.mjs configure --site https://YOUR-SITE
```

공개 사이트는 앱 API 토큰(`KG_TOKEN`)으로 연결합니다. 비공개 Sites에 연결할 때만 별도의 사이트 접근 토큰(`KG_SITES_TOKEN`)도 필요합니다.

| 환경변수 | 발급 위치와 역할 |
| --- | --- |
| `KG_TOKEN` | 필수. 웹앱에 로그인한 뒤 **API 연결**에서 만든 개인 API 토큰. 내 기록에 접근합니다. |
| `KG_SITES_TOKEN` | 비공개 사이트에만 필요. Sites 플러그인의 `get_site`가 반환하는 `siwc_bypass_bearer_token`으로 비공개 접근 경계를 통과합니다. |

공개 사이트는 서비스 토큰을 발급할 필요가 없습니다. 비공개 사이트에서 `get_site`에 서비스 토큰이 없다면 Sites의 서비스 접근 토큰 생성 기능을 사용합니다. 사람의 브라우저 로그인 쿠키를 복사하지 않습니다. CLI는 앱 토큰을 `Authorization`, 선택적인 Sites 토큰을 `OAI-Sites-Authorization` 헤더로 전송합니다. 리다이렉트에는 토큰을 전달하지 않습니다.

토큰은 로컬 비밀 관리 도구에서 위 환경변수에 주입하거나, Bash에서 다음처럼 화면에 표시하지 않고 입력할 수 있습니다.

```bash
read -rs -p '앱 API 토큰: ' KG_TOKEN; printf '\n'
export KG_TOKEN

# 비공개 사이트에 연결하는 경우에만 추가 설정
read -rs -p 'Sites 접근 토큰: ' KG_SITES_TOKEN; printf '\n'
export KG_SITES_TOKEN
```

또는 비밀 관리 도구가 `{ "site": "https://…", "token": "…", "sitesToken": "…" }` JSON을 표준 출력으로 내보내도록 하고 `node cli/kg.mjs configure --stdin`으로 연결할 수 있습니다. 설정 파일은 기본 `~/.config/atlas/config.json`에 권한 `0600`으로 저장됩니다. `KG_CONFIG`로 다른 파일을 지정할 수 있습니다. 환경변수가 저장된 설정보다 우선합니다. 토큰 값은 CLI 출력에 표시하지 않습니다.

## 기록하기

```bash
node cli/kg.mjs search "시스템 설계"
node cli/kg.mjs concept add "마이크로서비스" --category "시스템 설계" --alias MSA
node cli/kg.mjs add --concept NODE_ID --text "이번 프로젝트에서는 배포 자동화가 먼저 필요했다."
node cli/kg.mjs add --concept NODE_ID --file notes.md --url https://example.com/article --period "2020–2024"
node cli/kg.mjs add --concept NODE_ID --stdin < notes.md
node cli/kg.mjs link NODE_ID OTHER_ID --type related
node cli/kg.mjs show NODE_ID --json
node cli/kg.mjs export --file synapse-backup.json
```

하나의 기록을 여러 노드에 붙이려면 `--concept`를 반복합니다. `--period`는 내용이 다루는 시기이며 서버가 생성하는 기록 시점과 별개입니다. `--url`은 출처 링크입니다. 출처 본문은 자동 수집하지 않습니다. 동일 요청을 수동 재시도할 때 같은 `--key` 값을 주면 중복 저장을 방지할 수 있습니다.

Codex나 다른 CLI 에이전트에는 다음 작업 지침을 줄 수 있습니다.

> 작업에서 배운 내용을 사용자가 저장하라고 하면, `kg search`로 기존 노드를 찾은 뒤 핵심 내용과 출처를 `kg add`로 추가한다. 새 개념은 중복 여부를 확인한 뒤 만든다. 토큰을 명령 인수나 메모 본문에 넣지 않는다.

## Codex SDK 자동 요약

`@openai/codex-sdk`가 로컬 Codex 런타임을 실행합니다. 해당 컴퓨터에서 Codex 로그인을 완료하거나, 사용자 본인의 OpenAI API 자격증명을 실행 환경에 설정해야 합니다. 인증이 없을 때 대체 요약을 만들지 않으며 작업에 실패 상태를 남깁니다.

```bash
# 현재 대기 작업 하나 처리
node cli/kg.mjs worker --once

# 새 기록을 계속 확인하고 요약 (Ctrl+C로 종료)
node cli/kg.mjs worker

# 특정 노드의 요약을 다시 생성
node cli/kg.mjs summarize NODE_ID
```

이 명령을 실행해두면 대기 중인 요청을 가져와 메모를 읽고 요약합니다. 서버는 요약에 연결된 메모와 버전을 확인한 뒤 저장합니다. 처리하는 동안 메모가 바뀌었다면 이전 내용으로 만든 요약은 저장하지 않습니다. 이 프로그램을 꺼도 웹에서 메모를 쓰는 데는 문제가 없습니다. 요약에 실패했다면 인증과 실행 환경을 확인하고 **요약 갱신** 또는 `kg summarize`로 다시 요청하면 됩니다.

요약 실행은 최대 8분이며 읽기 전용 샌드박스, 네트워크와 웹 검색 비활성 설정을 사용합니다. 앱/API 토큰은 Codex 자식 프로세스의 환경변수에 전달하지 않습니다. 로컬 인증 정보를 재사용하는 개인용 실행 환경을 전제로 합니다. Codex에는 DB 접속 정보나 앱 API 토큰을 넘기지 않습니다.

## 컨테이너에서 계속 실행

```bash
docker build -f Dockerfile.worker -t synapse-worker .
docker run --rm --init --env-file /secure/synapse-worker.env \
  --mount type=bind,src=/secure/codex-auth,dst=/home/node/.codex \
  synapse-worker
```

환경 파일에는 `KG_URL`, `KG_TOKEN`을 설정합니다. 비공개 사이트에 연결할 때만 `KG_SITES_TOKEN`도 추가합니다. `/secure/codex-auth`에는 컨테이너 사용자에게 읽기·쓰기를 허용한 본인의 Codex 설정과 인증을 두거나, 인증에 사용하는 API 키를 런타임 비밀로 주입합니다. SDK가 세션 상태도 기록하므로 Codex 디렉터리는 쓰기 가능해야 합니다. 인증 파일과 환경 파일은 소스와 이미지에 포함하지 않습니다. 컨테이너를 상시 실행할 서버는 별도로 필요합니다.

테스트: `node cli/cli.test.mjs`.

## 그래프 에이전트 채팅 처리

`node cli/kg.mjs worker`를 실행하면 웹에서 보낸 키워드 채팅과 메모 요약을 함께 처리합니다. 키워드 채팅을 먼저 처리하고, 이어서 대기 중인 메모를 요약합니다. 이 기능이 없는 예전 CLI를 쓰고 있다면 웹에서 ZIP을 다시 받아 업데이트하면 됩니다.

대화 맥락과 기존 개념 목록을 받아 구조화된 생성 계획을 만들고, 서버가 검증한 뒤 노드와 관계를 원자적으로 추가합니다. 실패하거나 임대가 만료된 작업은 지도를 부분적으로 변경하지 않습니다. 대화는 순서대로 처리하고 사용자 간 데이터는 분리합니다.
