import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from './db/client.js';
import { config } from './config.js';
import { ApiError } from './lib/errors.js';
import { writeRateLimit } from './lib/rate-limit.js';
import { nowKst } from './lib/time.js';
import type { LlmClient } from './llm/client.js';
import { meetingDevRoutes } from './routes/meeting-dev.js';
import { personaRoutes } from './routes/persona.js';
import type { TourClient } from './tour/client.js';
import { tripRoutes } from './routes/trips.js';

export { nowKst } from './lib/time.js';

export interface AppOptions {
  /** null이면 DB 없이 실행함 (CI 이미지 확인처럼 /health만 필요한 경우) */
  db: Db | null;
  /** true이면 /dev/에서 백엔드 시험 화면을 제공함 (개발용, DEV_UI=true) */
  devUi?: boolean;
  /** null이면 LLM 없이 규칙 카드만 만듦 */
  llm?: LlmClient | null;
  llmDailyLimit?: number;
  llmCardsPerMember?: number;
  llmPerIpDaily?: number;
  ipHashSecret?: string;
  rateLimitPerMinute?: number;
  /** 집중률 예측 호출기 (회의 후보 찾기에서 씀, null이면 받아 둔 예측만 씀) */
  crowdClient?: TourClient | null;
}

const devUiFile = new URL('../dev-ui/index.html', import.meta.url);
const devMeetingFile = new URL('../dev-ui/meeting.html', import.meta.url);

/** 요청 본문 상한 (가장 큰 요청인 설문 응답도 약 1KB). 넘으면 읽지 않고 413 */
const MAX_BODY_BYTES = 32 * 1024;

export function createApp({
  db,
  devUi = false,
  llm = null,
  llmDailyLimit = config.llmDailyLimit,
  llmCardsPerMember = config.llmCardsPerMember,
  llmPerIpDaily = config.llmPerIpDaily,
  ipHashSecret = config.ipHashSecret,
  rateLimitPerMinute = config.rateLimitPerMinute,
  crowdClient = null,
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
    api.route('/', personaRoutes({ db, llm, llmDailyLimit, llmCardsPerMember, llmPerIpDaily, ipHashSecret }));
    if (devUi) api.route('/', meetingDevRoutes({ db, crowdClient }));
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
  }

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '요청한 경로가 없음' } }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err); // 내부 정보는 서버 로그에만 남기고 응답에는 넣지 않음
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '서버 내부 오류' } }, 500);
  });

  return app;
}
