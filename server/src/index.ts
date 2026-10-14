import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { connectDb } from './db/client.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) console.warn('DATABASE_URL이 없어 DB 없이 실행함 (/health만 동작)');
const db = databaseUrl ? await connectDb(databaseUrl) : null;
const devUi = process.env.DEV_UI === 'true';

serve({ fetch: createApp({ db, devUi }).fetch, port }, (info) => {
  console.log(`J-ourney 서버 실행 중: http://localhost:${info.port}/api/v1/health`);
  if (devUi) console.log(`백엔드 시험 화면: http://localhost:${info.port}/dev/`);
});
