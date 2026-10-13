# server — 백엔드·AI 서버

- 담당: 김건한
- 범위: REST API, WebSocket 회의 중계, AI 에이전트·페르소나
- 배포: Vercel (`develop` → 개발 서버, `main` → 운영 서버, 작업 브랜치 → 미리보기 URL)
- 기술 스택: Node.js, TypeScript, LangGraph.js (에이전트 흐름 관리), Claude Haiku 5.5 (Vercel AI Gateway 경유)
- 작업 브랜치: `server/setup`에서 계속 작업하고, 병합일마다 `develop`을 대상으로 PR을 열어 작성자가 직접 병합함 (기본 브랜치가 main이므로 PR 대상을 develop으로 지정함)
- 병합일 이후에는 `git merge origin/develop`으로 상대방 변경 사항을 받아 둠
- 비밀값: LLM·카카오 API 키 등은 Vercel 환경 변수에만 저장하며 저장소에 커밋하지 않음
