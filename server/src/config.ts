import { randomBytes } from 'node:crypto';
import { parseAccessKeys } from './lib/access.js';
import type { ReplayMode } from './llm/record.js';

/** 환경 변수로 바꿀 수 있는 운영 값 (server/.env, 값이 없으면 기본값) */
const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
/** 0을 허용하는 횟수 설정값 (비어 있거나 틀리면 기본값) */
const count = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export const config = {
  port: num('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL ?? null,
  devUi: process.env.DEV_UI === 'true',
  /** true이면 터널(팀원)로 들어온 요청도 시험 경로(회의 실행)를 씀. 실행마다 LLM·집중률을 부르므로 팀원 확인 기간에만 켬 (기본 꺼짐) */
  devUiTunnel: process.env.DEV_UI_TUNNEL === 'true',
  /** LangChain 공급자 이름과 모델 (예: anthropic / claude-haiku-5-5) */
  llmProvider: process.env.LLM_PROVIDER ?? 'anthropic',
  llmModel: process.env.LLM_MODEL ?? null,
  /** 예비 모델 '공급자:모델'을 쉼표로 나열 (앞 모델이 실패하면 순서대로 시도, 예: google-genai:gemini-3.5-flash-lite) */
  llmFallbacks: (process.env.LLM_FALLBACKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** 모델 하나당 응답 대기 시간. Claude 약 2.7초·Gemini 약 1.2초(실측)라 6초 + 예비 모델이어도 앱의 요청 제한 10초 안에 끝남 */
  llmTimeoutMs: num('LLM_TIMEOUT_MS', 6000),
  /** LLM 1회 호출의 토큰 상한 (입력 + 출력, 사용자 지시 99,900). 넘을 수 있는 요청은 부르지 않고 규칙 카드로 대신함 */
  llmCallTokenLimit: num('LLM_CALL_TOKEN_LIMIT', 99_900),
  /** 여행 하나에서 회의를 실행할 수 있는 횟수 (개발 중 3회, 사용자 결정 10/15) */
  meetingRunsPerTrip: count('MEETING_RUNS_PER_TRIP', 3),
  /** 회의 LLM의 모델 하나당 응답 대기 시간: 회의는 실시간 전송이라 화면 요청 제한(10초)과 무관해 성향 카드보다 길게 둠 */
  meetingLlmTimeoutMs: num('MEETING_LLM_TIMEOUT_MS', 15000),
  /**
   * 회의 실행 1회에서 부를 수 있는 LLM 횟수 (넘으면 규칙으로 대신함, 하루 상한과 별도로 셈)
   * 1–6단계 최대 13회(고르기 4×2·이름 맞추기 1·반응 4) + 7단계 평가 4–8회(사람마다 1회, 형식이 틀리면 1번 더) → 30 (10/28 7단계와 함께 올림)
   */
  meetingLlmCallsPerRun: num('MEETING_LLM_CALLS_PER_RUN', 30),
  /** 앱 표(Drizzle)용 DB 연결 수 */
  dbPoolMax: num('DB_POOL_MAX', 10),
  /** 회의 단계 저장(LangGraph 체크포인트)용 DB 연결 수 */
  checkpointPoolMax: num('CHECKPOINT_POOL_MAX', 3),
  /** 끝난 회의의 단계 기록을 지우기 전에 남겨 두는 일수 */
  meetingKeepDays: num('MEETING_KEEP_DAYS', 30),
  /** LLM 1회 응답(출력)의 토큰 상한. 위 상한 안에 들어가야 하며, 쓰는 모델이 모두 지원하는 값으로 둠 */
  llmMaxOutputTokens: num('LLM_MAX_OUTPUT_TOKENS', 8_192),
  /**
   * LLM 다시 쓰기 (10/19 사용자 지시: 이제 LLM은 부르지 않고 이미 나온 결과로만 확인, 시험 답을 녹화해 API 없이 다시 시험)
   * true(only): LLM을 부르지 않음 — 녹화된 같은 요청의 답 → 같은 여행의 지난 회의 AI 고르기·이름 맞추기, 같은 응답의 AI 카드 → 규칙
   * fill: 위처럼 다시 쓰고, 없는 요청만 LLM을 불러 녹화함 (측정용) · 그 밖: 다시 쓰지 않음(off). 실제로 부른 답은 늘 녹화함
   */
  llmReplay: ((v) => (v === 'true' ? 'only' : v === 'fill' ? 'fill' : 'off'))(process.env.LLM_REPLAY) as ReplayMode,
  /**
   * 접근 키 (10/26 사용자 지시): "이름:횟수:sha256(키)"를 쉼표로 이음. 키가 있으면 터널(바깥) 요청은 맞는 키(X-Access-Key 헤더, 시험 화면은 쿠키)를 낸 경우만
   * 회의를 시작하고(키마다 '횟수'번) AI 카드를 씀. 서버 안에서 보낸 요청(포트 연결)은 예전과 같음. 비우면 잠그지 않음
   */
  accessKeys: parseAccessKeys(process.env.ACCESS_KEYS),
  /** 접근 키로 시작한 회의·카드의 LLM 다시 쓰기 (LLM_REPLAY와 같은 값). 비우면 fill: 녹화된 답은 다시 쓰고 없는 요청만 LLM을 부름 */
  accessReplay: ((v) => (!v ? 'fill' : v === 'true' ? 'only' : v === 'fill' ? 'fill' : 'off'))(process.env.ACCESS_LLM_REPLAY?.trim()) as ReplayMode,
  /** 하루 LLM 호출 상한 (넘으면 규칙 카드로 대신함) */
  llmDailyLimit: num('LLM_DAILY_LIMIT', 500),
  /** 구성원 1명이 AI(LLM)로 카드를 만들 수 있는 횟수 (넘으면 규칙 카드로 대신함) */
  llmCardsPerMember: num('LLM_CARDS_PER_MEMBER', 2),
  /**
   * 터널로 들어온 IP 하나가 하루에 AI(LLM)를 쓸 수 있는 횟수. 이 PC에서 직접 보낸 요청은 세지 않음
   * 0이면 터널 요청(팀원 앱 개발)은 LLM을 부르지 않고 규칙 카드만 받음 (개발 기간 기본값, 시연 날에는 크게 올림)
   */
  llmPerIpDaily: count('LLM_PER_IP_DAILY', 0),
  /** IP를 저장하기 전에 섞는 비밀값. 없으면 실행할 때마다 새로 만들어, 서버를 다시 켜면 IP별 횟수가 초기화됨 */
  ipHashSecret: process.env.IP_HASH_SECRET || randomBytes(32).toString('hex'),
  /** IP별 쓰기 요청 제한 (1분당) */
  rateLimitPerMinute: num('RATE_LIMIT_PER_MINUTE', 60),
  /** 공공데이터포털 서비스 키 (TourAPI·집중률 등) */
  dataGoKrKey: process.env.DATA_GO_KR_SERVICE_KEY || null,
  /** 한국관광공사 관광지 집중률 예측 주소 */
  tourCrowdBase: process.env.TOUR_CROWD_API_BASE ?? 'https://apis.data.go.kr/B551011/TatsCnctrRateService',
  /** TourAPI MobileApp 값. 운영계정 심의에서 서비스 고유명을 확인하므로 바꾸지 않음 */
  tourMobileApp: process.env.TOUR_MOBILE_APP ?? 'J-ourney',
  /** 기능별 하루 TourAPI 호출 상한 (공공데이터포털 개발계정은 기능마다 하루 1,000건) */
  tourDailyLimit: num('TOUR_DAILY_LIMIT', 1000),
  /** TourAPI 응답 대기 (밀리초) */
  tourTimeoutMs: num('TOUR_TIMEOUT_MS', 20000),
  /** 카카오 REST API 키 (6단계 길찾기). 없으면 구간 정보는 '정보 없음'으로 두고 순서는 거리로 비교함 */
  kakaoRestKey: process.env.KAKAO_REST_API_KEY || null,
  /** 카카오맵 길찾기(대중교통·도보) 주소 · 카카오모빌리티 자동차 길찾기 주소 */
  kakaoMapBase: process.env.KAKAO_MAP_API_BASE ?? 'https://dapi.kakao.com',
  kakaoNaviBase: process.env.KAKAO_NAVI_API_BASE ?? 'https://apis-navi.kakaomobility.com',
  /** 기능별 하루 호출 상한: 대중교통·도보는 공식 무료 한도(하루 1,000건), 자동차는 공식 표에 없어(문의 글 하루 1만 건) 낮게 둠 */
  kakaoTransitDailyLimit: count('KAKAO_TRANSIT_DAILY_LIMIT', 1000),
  kakaoWalkDailyLimit: count('KAKAO_WALK_DAILY_LIMIT', 1000),
  kakaoCarDailyLimit: count('KAKAO_CAR_DAILY_LIMIT', 3000),
  kakaoTimeoutMs: num('KAKAO_TIMEOUT_MS', 8000),
};
