import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type AppOptions, createApp } from '../src/app.js';
import { migrationsFolder } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

/** 메모리 안의 PostgreSQL(PGlite)에 실제 마이그레이션을 적용한 시험용 서버 */
export async function createTestApp(options: Omit<AppOptions, 'db'> = {}) {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  // 시험은 요청이 많으므로 요청 제한을 넉넉히 둠 (제한 자체는 따로 시험함)
  return { app: createApp({ db, rateLimitPerMinute: 1000, ...options }), db };
}

type TestApp = ReturnType<typeof createApp>;

/** JSON 요청을 보내고 상태 코드와 본문을 돌려줌 */
export async function call(app: TestApp, method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** 시험용 가짜 LLM: respond가 돌려준 값을 스키마로 검사해 돌려줌 */
export function fakeLlm(respond: (input: any, call: number) => unknown) {
  const fake = {
    name: 'fake',
    calls: 0,
    async generateJson<T extends import('zod').ZodType>(req: import('../src/llm/client.js').JsonRequest<T>) {
      fake.calls++;
      return req.schema.parse(await respond(req.input, fake.calls)) as import('zod').infer<T>;
    },
  };
  return fake;
}

/** 15문항 응답 만들기: scale은 q1–q12 점수 */
export function answersOf(scale: number[], likes: string[], dislikes: string[], text?: string) {
  return [
    ...scale.map((value, i) => ({ questionId: `q${i + 1}`, value })),
    { questionId: 'q13', optionIds: likes },
    { questionId: 'q14', optionIds: dislikes },
    ...(text === undefined ? [] : [{ questionId: 'q15', text }]),
  ];
}

/** 서연형: 느긋형·한적형·늦잠형 */
export const SEOYEON = [5, 2, 2, 5, 2, 5, 5, 9, 8, 6, 7, 5];
/** 민수형: 계획형·부지런형·명소형 (부지런형·명소형·아침형이 동점) */
export const MINSU = [9, 8, 6, 3, 8, 7, 2, 3, 5, 8, 3, 4];
