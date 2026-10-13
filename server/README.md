# server — 백엔드·AI 서버

- 담당: 김건한
- 범위: REST API, WebSocket 이벤트 중계, AI 회의 엔진(페르소나 생성·자료조사·회의·확정 투표 집계)
- 설계 원칙: 판단은 LLM, 계산·검증은 코드, 최종 결정은 사람 4명 (요구사항·연동 명세서 v1.0)
- 배포: Docker 이미지 (GitHub Actions가 빌드하여 GHCR에 저장), 학교 VM 준비 전까지는 김건한 PC에서 docker compose로 실행하고 터널로 공유함
- 기술 스택: Node.js, TypeScript, LangGraph.js (에이전트 흐름 관리), PostgreSQL, Claude Haiku 5.5 (LLM 주소·모델은 환경 변수로 설정), 카카오 로컬 API, 네이버 검색 API
- 작업 브랜치: `server/setup`에서 계속 작업하고, 병합일마다 `develop`을 대상으로 PR을 열어 작성자가 직접 병합함 (기본 브랜치가 main이므로 PR 대상을 develop으로 지정함)
- 병합일 이후에는 `git merge origin/develop`으로 상대방 변경 사항을 받아 둠
- 비밀값: LLM·카카오·네이버 API 키는 `.env`와 GitHub Actions Secrets에만 저장하며 저장소에 커밋하지 않음
