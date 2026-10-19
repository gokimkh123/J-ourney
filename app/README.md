# app — 모바일 앱

- 담당: 전규민
- 범위: 안드로이드 시연용 모바일 앱 (README 4장 기준 필수 화면 A1–A3, B1–B4, C1–C3)
- 기준 문서: 요구사항·연동 명세서 v1.5, 동작 흐름 예시 (PDF), 지도 화면 미리보기 (HTML) (김건한 전달)
- 기술 스택: Expo (React Native), TypeScript
- 작업 브랜치: `app/setup`에서 계속 작업하고, 병합일마다 `develop`을 대상으로 PR을 열어 작성자가 직접 병합함 (기본 브랜치가 main이므로 PR 대상을 develop으로 지정함)
- 병합일 이후에는 `git merge origin/develop`으로 상대방 변경 사항을 받아 둠
- 서버 주소: 개발 중에는 김건한 PC의 개발 서버(터널 주소)를 사용하며, 주소는 설정값 하나로 바꿀 수 있게 구성함
- 비밀값: 앱에는 어떤 API 키도 넣지 않으며, 외부 API 호출은 모두 서버를 거침
- 보안 검사: 저장소를 받은 뒤 최상위 폴더에서 `git config core.hooksPath .githooks`를 한 번 실행함 (커밋 전 비밀값·개인정보 검사). develop 병합은 CI의 비밀값 검사(gitleaks)를 통과해야 가능함
