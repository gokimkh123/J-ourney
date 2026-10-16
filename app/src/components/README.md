# 컴포넌트 안내 (디자인 세션)

화면(`src/app/*.tsx`)은 `src/components/index.ts`에서 가져다 쓰고, 색·간격·글자는 `src/theme/index.ts` 토큰만 쓴다. 컴포넌트는 props만 받는다(서버·세션·lib/meeting을 직접 부르지 않음).

## 토큰 (`src/theme/`)
- `colors`: 다크 바탕(background → surface → surfaceRaised), 포인트 `accent`, 상태 success·warning·danger, 지도색. 구성원 색 `memberColors`는 `lib/theme.ts` 것을 그대로 재수출한다.
- `spacing` 4pt(xs 4 · sm 8 · md 16 · lg 24 · xl 32), `radius` sm·md·lg·xl·full, `typography` 이름 붙은 글자 스타일, `duration`·`easing` 모션.
- 폰트(Jua·Noto Sans KR)를 넣기로 하면 `typography.ts`의 `fontFamily` 두 값만 바꾼다.
- `lib/theme.ts`의 밝은 `colors`는 기존 화면이 아직 쓰고 있어 남겨 둠. 화면을 하네스로 옮기면서 `theme/`로 바꾼 뒤 지우면 된다(로직 세션 영역).

## 화면별로 쓰는 컴포넌트
| 화면 | 컴포넌트 |
|---|---|
| 공통 | AppText, Button(primary/secondary/ghost · sm/md/lg · loading/disabled), Card, Chip, StatusPill, ProgressBar, TextField, Banner, Avatar/AvatarStack |
| A3 캐릭터 카드 | PersonaCard (props 그대로 `persona`) |
| B1 회의 조건 | TextField, Chip(이동 수단), Card(규칙), AvatarStack, Button block |
| B2 회의 진행 | MeetingMap + BottomSheet + AgentStatusRow / CandidateRow / SpeechRow |
| B3 AI 합의안 | Card, StatGroup, SatisfactionRow, ConcessionRow, StatusPill(찬반) |
| C1 합의 일정 | SegmentedTabs(일차), ScheduleItem, ProgressBar(예산) |
| C2 근거 보기 | Banner(verified:false), SpeechRow(reasons), InfoList, StatusPill(sources) |

## 데이터 → props 연결 메모
- `Avatar`: `color`, `chips`, `name`, `size`. 캐릭터 그림 교체는 `Avatar.tsx`의 `AvatarArt` 한 곳만 바꾼다.
- `MeetingMap`: `bounds`는 `boundsAround(후보·focus 좌표들)`로 만든다. `agents[].lat/lng`는 `research.progress`의 `focus`, `searching`은 stage가 planning·searching일 때. `pins`는 `board.updated`의 candidates(색 = proposedBy[0] 구성원 색). `bubble`은 마지막 `agent.message`. `routes`는 `plan.proposed`의 route. 위치가 바뀌면 아바타가 알아서 이동 애니메이션한다(시스템 "동작 줄이기"면 바로 이동).
- `AgentStatusRow.statusTone`: 조사 중 accent · 완료 success · 준비 neutral.
- `CandidateRow.reactions[].kind`: like → 좋아요, warn → 조심, block → 반대.
- `SatisfactionRow.threshold`: 회의 규칙 `aiMinSatisfaction`.
- `ScheduleItem.moveLabel`: `moveFromPrev`를 "버스 24분 · 1,500원" 형태 글자로 만들어 넘긴다(포맷 함수는 lib/ui 쪽).
