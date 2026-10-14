import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createApp } from '../src/app.js';
import { migrationsFolder } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

/** 메모리 안의 PostgreSQL(PGlite)에 실제 마이그레이션을 적용한 시험용 서버 */
export async function createTestApp() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return { app: createApp({ db }), db };
}

type TestApp = ReturnType<typeof createApp>;

/** JSON 요청을 보내고 상태 코드와 본문을 돌려줌 */
export async function call(app: TestApp, method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
