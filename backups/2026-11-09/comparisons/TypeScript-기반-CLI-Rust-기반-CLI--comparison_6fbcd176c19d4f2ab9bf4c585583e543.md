# TypeScript 기반 CLI · Rust 기반 CLI

구현 언어와 UI 도구, 실행 환경, 배포 경로를 구분한다.

| 항목 | TypeScript | Rust |
| --- | --- | --- |
| 본체 실행 | JavaScript로 출력해 Node.js 등에서 실행한다. 지원 문법을 직접 제거하는 호스트도 있다. | 플랫폼별 네이티브 실행 파일로 실행한다. 별도 Node.js·JVM 없이 실행할 수 있다. |
| 터미널 UI | React·Ink 등 JavaScript 생태계 도구를 사용할 수 있다. | Ratatui 등 Rust 생태계 도구를 사용할 수 있다. |
| 런타임 역할 | JavaScript 엔진과 호스트가 실행·입출력을 지원한다. | OS·ABI와 실행 지원 코드가 필요하다. 별도 언어 VM이 없다는 뜻이지 환경이 전혀 필요 없다는 뜻은 아니다. |
| npm 배포 | JavaScript 코드와 실행 진입점을 패키지로 배포할 수 있다. | 네이티브 파일과 런처를 패키지로 배포할 수 있다. npm 사용이 구현 언어를 결정하지 않는다. |
| Codex의 npm 경로 | JavaScript 진입점이 Node.js로 실행된다. | 현재 npm 런처는 Node.js에서 플랫폼별 Rust 실행 파일을 선택해 시작한다. 직접 바이너리 실행과 구분한다. |
