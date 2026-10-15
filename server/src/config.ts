import { randomBytes } from 'node:crypto';

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
  /** LLM 1회 응답(출력)의 토큰 상한. 위 상한 안에 들어가야 하며, 쓰는 모델이 모두 지원하는 값으로 둠 */
  llmMaxOutputTokens: num('LLM_MAX_OUTPUT_TOKENS', 8_192),
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
};
