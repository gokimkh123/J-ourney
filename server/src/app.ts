import { readFile } from 'node:fs/promises';
import { type BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from './db/client.js';
import { config } from './config.js';
import { ApiError } from './lib/errors.js';
import { writeRateLimit } from './lib/rate-limit.js';
import { nowKst } from './lib/time.js';
import type { LlmClient } from './llm/client.js';
import { type ReplayMode, llmRecorder } from './llm/record.js';
import { buildMeetingGraph } from './meeting/graph.js';
import { EventHub } from './meeting/live.js';
import { meetingService } from './meeting/service.js';
import { meetingDevRoutes } from './routes/meeting-dev.js';
import { meetingRoutes } from './routes/meetings.js';
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
  /** 회의 단계 저장 (운영: Postgres, 시험: 메모리) */
  checkpointer?: BaseCheckpointSaver;
  meetingRunsPerTrip?: number;
  meetingLlmCallsPerRun?: number;
  /** 회의 이벤트를 실시간 연결(WebSocket)로 보내는 곳. 없으면 새로 만듦 */
  hub?: EventHub;
  /** 실시간 연결 ping 간격 (시험에서 줄일 때만, 기본 명세서 25초) */
  livePingMs?: number;
}

const devUiFile = new URL('../dev-ui/index.html', import.meta.url);
const devMeetingFile = new URL('../dev-ui/meeting.html', import.meta.url);
const devAppFile = new URL('../dev-ui/app.html', import.meta.url);
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
  checkpointer = new MemorySaver(),
  meetingRunsPerTrip = config.meetingRunsPerTrip,
  meetingLlmCallsPerRun = config.meetingLlmCallsPerRun,
  hub = new EventHub(),
  livePingMs,
}: AppOptions) {
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
    api.route('/', tripRoutes(db));
    // LLM 녹화·재생: 실제로 부른 답은 늘 녹화하고, only(LLM_REPLAY=true)면 LLM 호출기를 넘기지 않아 어떤 경로도 LLM을 부르지 않음
    const mode: ReplayMode = llmReplay === true ? 'only' : llmReplay === false ? 'off' : llmReplay;
    const recorder = llmRecorder(db, (llm ?? meetingLlm)?.name ?? 'none', mode);
    api.route('/', personaRoutes({ db, llm: mode === 'only' ? null : llm, recorder, llmDailyLimit, llmCardsPerMember, llmPerIpDaily, ipHashSecret }));
    // 회의 그래프와 실행기는 서버가 켜질 때 한 번만 만들고 공식 경로·시험 경로가 함께 씀
    const limits = { runsPerTrip: meetingRunsPerTrip, llmCallsPerRun: meetingLlmCallsPerRun, llmDailyLimit };
    const graph = buildMeetingGraph({ db, crowdClient, llm: mode === 'only' ? null : (meetingLlm ?? llm), recorder, limits, checkpointer, traceLlm: true });
    const service = meetingService({ db, graph, limits, publisher: hub, replay: mode !== 'off' });
    api.route('/', meetingRoutes({ db, service, hub, pingMs: livePingMs }));
    if (devUi) api.route('/', meetingDevRoutes({ db, crowdClient, limits, service, hub, allowTunnel: devUiTunnel, replay: mode !== 'off' }));
  } else {
    api.all('*', () => {
      throw new ApiError('INTERNAL_ERROR', 'DB가 설정되지 않아 사용할 수 없음');
    });
  }

  const app = new Hono();
  app.route('/api/v1', api);

  if (devUi) {
    app.get('/dev', (c) => c.redirect('/dev/'));
    app.get('/dev/', async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devUiFile, 'utf8'));
    });
    // 회의 엔진 단계별 시험 화면 (1–15단계를 하나씩 실행해 봄)
    app.get('/dev/meeting', async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devMeetingFile, 'utf8'));
    });
    // 앱처럼 보이는 시연 화면 (개발자 도구 휴대폰 보기용): 시연 여행 → 성향 카드 → 조건 → 지도 위 AI 회의
    app.get('/dev/app', async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.html(await readFile(devAppFile, 'utf8'));
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
