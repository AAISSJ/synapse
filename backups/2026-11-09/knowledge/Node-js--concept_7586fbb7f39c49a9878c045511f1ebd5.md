# Node.js

다른 이름: Node · nodejs

주제: 컴퓨터 언어

V8과 입출력 지원을 결합해 브라우저 밖에서 JavaScript를 실행하는 환경이다.

## 용어

### V8

JavaScript와 WebAssembly를 실행하는 엔진으로 Node.js와 Chromium 등에서 사용한다.

### libuv

이벤트 루프와 비동기 입출력 등을 지원하는 라이브러리다.

### Type stripping

지원되는 TypeScript 타입 문법을 제거하는 기능이다. 타입 검증과 별개다.

## Node.js · 역할과 핵심 개념

기록일: 2026-11-01T09:54:46.931Z

## 언어와 실행 환경의 구분
Node.js는 언어가 아니라 JavaScript 실행 환경이다. V8 엔진과 파일·네트워크·프로세스 API 등을 제공한다. React나 npm과도 역할이 다르다.

TypeScript 서버는 보통 JavaScript로 출력한 코드를 Node.js로 실행한다. 최신 Node.js의 지원 범위에서는 일부 TypeScript 문법을 직접 제거해 실행할 수 있지만 타입 검사를 수행하지 않으며 모든 TypeScript 변환 기능을 대체하지도 않는다.

Codex의 Rust 실행 파일 본체는 Node.js 없이 실행할 수 있다. 다만 npm 패키지의 현재 명령 진입점은 Node.js 런처이므로 그 설치 경로에서는 Node.js 의존성을 함께 확인해야 한다.
