# 여행회의 앱 (Expo SDK 57 · Expo Router · TypeScript)

- 화면은 `src/app/`(Expo Router)에 두고, 로직은 `src/lib/<영역>/`의 순수 TypeScript 모듈로 분리한다. 화면은 로직을 호출만 한다.
- 순수 모듈은 `react`, `react-native`, `expo`를 import하지 않는다. 상대 경로 import에는 `.ts` 확장자를 쓴다. enum, namespace, parameter property는 쓰지 않는다.
- 테스트는 `*.test.ts`에 `node:test`와 `node:assert/strict`만 쓴다. 기존 테스트는 수정하지 않는다.
- 의존성 추가, 설정 파일(`package.json`, `app.json`, `tsconfig.json`) 수정, 네트워크 접근, 외부 문서 조회는 하지 않는다. 필요하면 질문으로 남긴다.
- 서버 주소와 가짜 데이터 사용 여부는 설정값 한 곳에서 전환할 수 있게 한다.
- API는 `/api/v1`, 필드명은 camelCase, 시간은 ISO 8601 한국 시간(+09:00), 오류는 `{ "error": { "code", "message" } }` 형식이다. 기준 문서는 연동 명세서 v1.1이다.
