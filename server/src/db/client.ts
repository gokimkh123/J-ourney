import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import pg from 'pg';
import postgres from 'postgres';
import * as schema from './schema.js';

/** 운영(postgres.js)과 시험(PGlite)이 함께 쓰는 DB 타입 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** drizzle-kit이 만든 마이그레이션 폴더 (server/drizzle) */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** DATABASE_URL로 접속하고 아직 적용하지 않은 마이그레이션을 실행함 */
export async function connectDb(url: string): Promise<Db> {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

/**
 * LangGraph 체크포인트 전용 연결 풀 (PostgresSaver가 씀)
 * 쉬던 연결이 끊기면(DB 재시작 등) 풀이 'error'를 냄. 받는 곳이 없으면 서버가 꺼지므로 기록만 함 (다음 요청은 새 연결을 씀)
 */
export function checkpointPool(url: string, max: number) {
  const pool = new pg.Pool({ connectionString: url, max });
  pool.on('error', (err) => console.warn('체크포인트 DB 연결 끊김:', err.message));
  return pool;
}
