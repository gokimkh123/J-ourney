# server — 백엔드·AI 서버

- 담당: 김건한
- 범위: REST API, WebSocket 이벤트 중계, AI 회의 엔진(페르소나 생성·자료조사·회의·확정 투표 집계)
- 설계 원칙: 판단은 LLM, 계산·검증은 코드, 최종 결정은 사람 4명 (요구사항·연동 명세서 v1.5)
- 배포: Docker 이미지 (GitHub Actions가 빌드하여 GHCR에 저장), 학교 VM 준비 전까지는 김건한 PC에서 docker compose로 실행하고 터널로 공유함
- 실행: `.env.example`을 참고해 `server/.env`를 만든 뒤 `server` 폴더에서 `docker compose up -d --build`를 실행함 (서버·PostgreSQL·터널). 공유 주소는 `docker compose logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'`로 확인하며, 터널을 다시 시작할 때마다 바뀌므로 저장소에 적지 않음
- 시험 화면: compose로 실행하면 `http://localhost:3000/dev/`에서 API를 직접 호출해 볼 수 있음 (`DEV_UI=true`일 때만 제공하며 운영 VM에서는 켜지 않음)
- DB 테이블: `src/db/schema.ts`를 고친 뒤 `npm run db:generate`로 `drizzle/`에 마이그레이션 SQL을 만들며, 서버가 시작할 때 아직 적용하지 않은 마이그레이션을 자동 적용함
- 기술 스택: Node.js 24, TypeScript, Hono, Zod, LangGraph.js (에이전트 흐름 관리), PostgreSQL, Drizzle ORM, LangChain으로 LLM 연결 (현재 Claude Haiku 5.5, 실패 시 Gemini 3.5 Flash-Lite로 자동 전환, 공급자·모델은 환경 변수로 교체), 카카오 로컬·경로 API, 한국관광공사 TourAPI·연관 관광지·집중률 예측, 기상청 단기예보(선택)
- 작업 브랜치: `server/setup`에서 계속 작업하고, 병합일마다 `develop`을 대상으로 PR을 열어 작성자가 직접 병합함 (기본 브랜치가 main이므로 PR 대상을 develop으로 지정함)
- 병합일 이후에는 `git merge origin/develop`으로 상대방 변경 사항을 받아 둠
- 비밀값: LLM·카카오·공공데이터포털 API 키는 `server/.env`(git 제외)와 GitHub Actions Secrets에만 저장하며 저장소에 커밋하지 않음
- 보안 검사: 저장소를 받은 뒤 최상위 폴더에서 `git config core.hooksPath .githooks`를 한 번 실행함 (커밋 전 비밀값·개인정보 검사). develop 병합은 CI의 비밀값 검사(gitleaks)를 통과해야 가능함
