import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`J-ourney 서버 실행 중: http://localhost:${info.port}/api/v1/health`);
});
