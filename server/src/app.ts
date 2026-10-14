import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import type { Db } from './db/client.js';
import { ApiError } from './lib/errors.js';
import { tripRoutes } from './routes/trips.js';

/** 한국 시간(+09:00) ISO 8601 문자열 (명세서 3장 공통 규칙) */
export function nowKst(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

export interface AppOptions {
  /** null이면 DB 없이 실행함 (CI 이미지 확인처럼 /health만 필요한 경우) */
  db: Db | null;
  /** true이면 /dev/에서 백엔드 시험 화면을 제공함 (개발용, DEV_UI=true) */
  devUi?: boolean;
}

const devUiFile = new URL('../dev-ui/index.html', import.meta.url);

export function createApp({ db, devUi = false }: AppOptions) {
  const api = new Hono();

  // 서버 연결 확인 (인증 불필요, 명세서 4.1)
  api.get('/health', (c) => c.json({ status: 'ok', time: nowKst() }));

  if (db) {
    api.route('/', tripRoutes(db));
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
  }

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '요청한 경로가 없음' } }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err); // 내부 정보는 서버 로그에만 남기고 응답에는 넣지 않음
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '서버 내부 오류' } }, 500);
  });

  return app;
}
