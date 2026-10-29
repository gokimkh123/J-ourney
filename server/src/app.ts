import { readFile } from 'node:fs/promises';
import { type BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import type { Db } from './db/client.js';
import { config } from './config.js';
import { ACCESS, type AccessKey, accessOf, matchKey } from './lib/access.js';
import { ApiError } from './lib/errors.js';
import { createMonitor, monitorStats } from './lib/monitor.js';
import { tunnelIp, writeRateLimit } from './lib/rate-limit.js';
import { nowKst } from './lib/time.js';
import type { LlmClient } from './llm/client.js';
import { type ReplayMode, llmRecorder } from './llm/record.js';
import { buildMeetingGraph } from './meeting/graph.js';
import type { RouteClient } from './meeting/route.js';
import { EventHub } from './meeting/live.js';
import { meetingService } from './meeting/service.js';
import { meetingDevRoutes } from './routes/meeting-dev.js';
import { meetingRoutes } from './routes/meetings.js';
import { planRoutes } from './routes/plan.js';
import { planService } from './meeting/choose.js';
import { personaRoutes } from './routes/persona.js';
import type { TourClient } from './tour/client.js';
import { tripRoutes } from './routes/trips.js';

export { nowKst } from './lib/time.js';

export interface AppOptions {
  /** null이면 DB 없이 실행함 (CI 이미지 확인처럼 /health만 필요한 경우) */
  db: Db | null;
  /** true이면 /dev/에서 백엔드 시험 화면을 제공함 (개발용, DEV_UI=true) */
  devUi?: boolean;
  /** true이면 터널로 들어온 요청도 시험 경로를 씀 (DEV_UI_TUNNEL=true, 기본 꺼짐) */
  devUiTunnel?: boolean;
  /** null이면 LLM 없이 규칙 카드만 만듦 */
  llm?: LlmClient | null;
  /** LLM 다시 쓰기 (LLM_REPLAY): true·'only'면 LLM을 부르지 않고 녹화·지난 결과만, 'fill'이면 없는 요청만 부르고 녹화 */
  llmReplay?: boolean | ReplayMode;
  llmDailyLimit?: number;
  llmCardsPerMember?: number;
  llmPerIpDaily?: number;
  ipHashSecret?: string;
  rateLimitPerMinute?: number;
  /** 집중률 예측 호출기 (회의 후보 찾기에서 씀, null이면 받아 둔 예측만 씀) */
  crowdClient?: TourClient | null;
  /** 회의용 LLM (응답 대기 시간이 다름). 없으면 llm을 씀 */
  meetingLlm?: LlmClient | null;
  /** 여행지 확인 LLM (조건 저장 때 방장이 쓴 여행지를 공식 지역 목록에서 고름). 없으면 llm을 씀 (LLM_REPLAY=true면 녹화만). 시험에서 바꿔 끼울 때만 넘김 */
  destinationLlm?: LlmClient | null;
  /** 회의 단계 저장 (운영: Postgres, 시험: 메모리) */
  checkpointer?: BaseCheckpointSaver;
  meetingRunsPerTrip?: number;
  meetingLlmCallsPerRun?: number;
  /** 회의 이벤트를 실시간 연결(WebSocket)로 보내는 곳. 없으면 새로 만듦 */
  hub?: EventHub;
  /** 실시간 연결 ping 간격 (시험에서 줄일 때만, 기본 명세서 25초) */
  livePingMs?: number;
  /** 6단계 길찾기 호출기 (카카오, 하루 한도 포함). null이면 저장된 길찾기만 씀 */
  routeClient?: RouteClient | null;
  /** 접근 키 (ACCESS_KEYS): 있으면 터널 요청은 맞는 키를 낸 경우만 회의를 시작하고(키마다 횟수) AI 카드를 씀 */
  accessKeys?: readonly AccessKey[];
  /** 키를 낸 요청의 LLM 다시 쓰기 (ACCESS_LLM_REPLAY, 기본 fill). LLM_REPLAY=true여도 이 모드로 LLM을 부름 */
  accessReplay?: ReplayMode;
}

/** 시험 화면 접근 키 입력 화면 (터널로 시험 화면을 쓸 때만) */
const keyPage = (error = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>J-ourney 접근 키</title><style>body{font-family:Pretendard,system-ui,sans-serif;max-width:360px;margin:12vh auto;padding:0 16px;color:#17191c}
input,button{width:100%;box-sizing:border-box;font-size:16px;padding:12px;border-radius:12px;margin-top:10px}input{border:1.5px solid #d5d8de}button{border:0;background:#1e2126;color:#fff;font-weight:700}
p{color:#6b7280;font-size:14px}.e{color:#dc2626}</style></head><body><h2>접근 키</h2><p>키를 넣으면 이 브라우저에서 시험 화면을 쓸 수 있음 (30일 기억)</p>
${error ? `<p class="e">${error}</p>` : ''}<form method="post" action="/dev/key"><input name="key" type="password" autocomplete="off" required><button>확인</button></form></body></html>`;

const devUiFile = new URL('../dev-ui/index.html', import.meta.url);
const devMeetingFile = new URL('../dev-ui/meeting.html', import.meta.url);
const devAppFile = new URL('../dev-ui/app.html', import.meta.url);
const devMonitorFile = new URL('../dev-ui/monitor.html', import.meta.url);
/** 시연 화면 그림 (그림 지도·캐릭터). 이 폴더 바로 아래의 이 형식 파일만 내보냄 */
const devImgDir = new URL('../dev-ui/img/', import.meta.url);
const DEV_IMG_TYPES: Record<string, string> = { png: 'image/png', webp: 'image/webp' };

/** 요청 본문 상한 (가장 큰 요청인 설문 응답도 약 1KB). 넘으면 읽지 않고 413 */
const MAX_BODY_BYTES = 32 * 1024;

export function createApp({
  db,
  devUi = false,
  devUiTunnel = false,
  llm = null,
  llmReplay = config.llmReplay,
  llmDailyLimit = config.llmDailyLimit,
  llmCardsPerMember = config.llmCardsPerMember,
  llmPerIpDaily = config.llmPerIpDaily,
  ipHashSecret = config.ipHashSecret,
  rateLimitPerMinute = config.rateLimitPerMinute,
  crowdClient = null,
  meetingLlm,
  destinationLlm,
  checkpointer = new MemorySaver(),
  meetingRunsPerTrip = config.meetingRunsPerTrip,
  meetingLlmCallsPerRun = config.meetingLlmCallsPerRun,
  hub = new EventHub(),
  livePingMs,
  routeClient = null,
  accessKeys = config.accessKeys,
  accessReplay = config.accessReplay,
}: AppOptions) {
  // 터널로 시험 경로를 여는데(DEV_UI_TUNNEL) 접근 키가 하나도 없으면 열지 않음 (키를 빠뜨려 바깥에 실제 API가 열리지 않게, 서버 시작 로그에 경고)
  const tunnelDev = devUiTunnel && accessKeys.length > 0;
  // 관리자 디버깅 화면(/dev/monitor)용 요청·WebSocket 기록 (시험 화면을 켠 서버만, 메모리에만)
  const monitor = devUi ? createMonitor({ accessKeys, ipSecret: ipHashSecret }) : null;
  const api = new Hono();
  api.use('*', writeRateLimit(rateLimitPerMinute));
  api.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new ApiError('PAYLOAD_TOO_LARGE', `요청 본문은 ${MAX_BODY_BYTES / 1024}KB 이하여야 함`);
      },
    }),
  );

  // 서버 연결 확인 (인증 불필요, 명세서 4.1)
  api.get('/health', (c) => c.json({ status: 'ok', time: nowKst() }));

  if (db) {
    // LLM 녹화·재생: 실제로 부른 답은 늘 녹화하고, only(LLM_REPLAY=true)면 LLM 호출기를 넘기지 않아 어떤 경로도 LLM을 부르지 않음
    const mode: ReplayMode = llmReplay === true ? 'only' : llmReplay === false ? 'off' : llmReplay;
    const recorder = llmRecorder(db, (llm ?? meetingLlm)?.name ?? 'none', mode);
    // 접근 키를 낸 요청: 전체가 녹화만(only)이어도 accessReplay 모드로 LLM을 씀 (녹화는 같은 표·같은 지문)
    const anyLlm = llm ?? meetingLlm ?? null;
    const liveRecorder = mode === 'only' && accessKeys.length > 0 && accessReplay !== 'only' && anyLlm ? llmRecorder(db, anyLlm.name, accessReplay) : null;
    const live = liveRecorder && llm ? { llm, recorder: liveRecorder } : null;
    const tripLlm = destinationLlm !== undefined ? destinationLlm : mode === 'only' ? null : llm;
    api.route('/', tripRoutes(db, { llm: tripLlm, recorder, live, llmDailyLimit, accessKeys }));
    api.route('/', personaRoutes({ db, llm: mode === 'only' ? null : llm, recorder, llmDailyLimit, llmCardsPerMember, llmPerIpDaily, ipHashSecret, accessKeys, live }));
    // 회의 그래프와 실행기는 서버가 켜질 때 한 번만 만들고 공식 경로·시험 경로가 함께 씀
    const limits = { runsPerTrip: meetingRunsPerTrip, llmCallsPerRun: meetingLlmCallsPerRun, llmDailyLimit };
    const graph = buildMeetingGraph({ db, crowdClient, llm: mode === 'only' ? null : (meetingLlm ?? llm), recorder, limits, checkpointer, traceLlm: true, router: routeClient });
    const liveGraph = liveRecorder ? buildMeetingGraph({ db, crowdClient, llm: meetingLlm ?? llm, recorder: liveRecorder, limits, checkpointer, traceLlm: true, router: routeClient }) : undefined;
    const service = meetingService({ db, graph, liveGraph, limits, publisher: hub, replay: mode !== 'off', liveReplay: accessReplay !== 'off' });
    api.route('/', meetingRoutes({ db, service, hub, pingMs: livePingMs, accessKeys, monitor }));
    // 13–15단계 (사람 선택·고치기·확정): 고칠 때 6단계 계산에 회의 단계 기록과 카카오 길찾기를 씀
    api.route('/', planRoutes({ db, plans: planService({ db, graph, router: routeClient, publisher: hub }) }));
    if (devUi) api.route('/', meetingDevRoutes({ db, crowdClient, limits, service, hub, allowTunnel: tunnelDev, replay: mode !== 'off', accessKeys }));
  } else {
    api.all('*', () => {
      throw new ApiError('INTERNAL_ERROR', 'DB가 설정되지 않아 사용할 수 없음');
    });
  }

  const app = new Hono();
  // 기본 보안 헤더 (내용 보안 정책 CSP는 시험 화면이 바깥 지도 스크립트를 써서 넣지 않음)
  app.use('*', secureHeaders());
  if (monitor) app.use('*', monitor.middleware);
  app.route('/api/v1', api);

  if (devUi) {
    // 터널로 시험 화면을 쓰는데(DEV_UI_TUNNEL) 접근 키가 있는 서버면 먼저 키를 넣음: 맞으면 HttpOnly 쿠키로 기억 (키 원문은 응답·로그에 넣지 않음)
    const needKey = (c: Context) => tunnelDev && accessOf(c, accessKeys).kind === 'none';
    app.get('/dev/key', (c) => c.html(keyPage()));
    app.post('/dev/key', writeRateLimit(rateLimitPerMinute), bodyLimit({ maxSize: 1024 }), async (c) => {
      const form = await c.req.parseBody();
      const key = typeof form.key === 'string' ? form.key.trim() : '';
      if (!matchKey(accessKeys, key)) return c.html(keyPage('키가 맞지 않음'), 403);
      setCookie(c, ACCESS.cookie, key, { path: '/', httpOnly: true, secure: true, sameSite: 'Strict', maxAge: ACCESS.cookieDays * 86_400 });
      return c.redirect('/dev/');
    });
    app.get('/dev', (c) => c.redirect('/dev/'));
    app.get('/dev/', async (c) => {
      if (needKey(c)) return c.redirect('/dev/key');
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devUiFile, 'utf8'));
    });
    // 회의 엔진 단계별 시험 화면 (1–15단계를 하나씩 실행해 봄)
    app.get('/dev/meeting', async (c) => {
      if (needKey(c)) return c.redirect('/dev/key');
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devMeetingFile, 'utf8'));
    });
    // 앱처럼 보이는 시연 화면 (개발자 도구 휴대폰 보기용): 시연 여행 → 성향 카드 → 조건 → 지도 위 AI 회의
    app.get('/dev/app', async (c) => {
      if (needKey(c)) return c.redirect('/dev/key');
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devAppFile, 'utf8'));
    });
    // 관리자 디버깅 화면 (10/29): 들어오는 요청·WebSocket·분당 횟수·오늘 호출 수. 서버 컴퓨터(ssh로 연 로컬 주소)에서만 — 터널로는 팀 키가 있어도 403
    const adminOnly = (c: Context) => (tunnelIp(c) === null ? null : c.json({ error: { code: 'FORBIDDEN', message: '관리자 화면은 서버 컴퓨터(ssh로 연 주소)에서만 열 수 있음' } }, 403));
    app.get('/dev/monitor', async (c) => {
      const denied = adminOnly(c);
      if (denied) return denied;
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devMonitorFile, 'utf8'));
    });
    app.get('/dev/monitor/data', async (c) => {
      const denied = adminOnly(c);
      if (denied) return denied;
      c.header('Cache-Control', 'no-store');
      return c.json({ ...(db ? await monitorStats(db) : {}), ...monitor!.snapshot() });
    });
    // 파일 이름 규칙(영문 소문자·숫자·-)에 맞지 않으면 읽지 않음 → 폴더 밖 경로로 나갈 수 없음
    app.get('/dev/img/:name', async (c) => {
      const m = /^[a-z0-9-]+\.(png|webp)$/.exec(c.req.param('name'));
      const body = m ? await readFile(new URL(m[0], devImgDir)).catch(() => null) : null;
      if (!m || !body) return c.json({ error: { code: 'NOT_FOUND', message: '요청한 그림이 없음' } }, 404);
      return c.body(new Uint8Array(body), 200, { 'Content-Type': DEV_IMG_TYPES[m[1]], 'Cache-Control': 'max-age=300' });
    });
  }

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '요청한 경로가 없음' } }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err); // 내부 정보는 서버 로그에만 남기고 응답에는 넣지 않음
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '서버 내부 오류' } }, 500);
  });

  return app;
}
