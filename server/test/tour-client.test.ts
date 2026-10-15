import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { type Db, migrationsFolder } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { createTourClient, TourApiError, type TourFetch } from '../src/tour/client.js';
import { tourCallsToday, tryConsumeTourCall } from '../src/tour/usage.js';

const KEY = 'a'.repeat(64);
const BASE = 'https://apis.data.go.kr/B551011/TatsCnctrRateService';

async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

const OK = JSON.stringify({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: '', totalCount: 0 } } });
const QUOTA_XML =
  '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';

/** 가짜 TourAPI: 부른 주소를 남기고 정한 본문을 돌려줌 */
function fakeFetch(body: string) {
  const calls: string[] = [];
  const fetch: TourFetch = async (url) => {
    calls.push(url);
    return { status: 200, text: async () => body };
  };
  return { fetch, calls };
}

describe('TourAPI 호출기 (회의 후보 찾기의 집중률 예측에서 씀)', () => {
  it('하루 상한에 닿으면 부르지 않고 budget 오류를 내며, 호출 수는 기능별로 DB에 남음', async () => {
    const db = await testDb();
    const f = fakeFetch(OK);
    const client = createTourClient({ baseUrl: BASE, serviceKey: KEY, mobileApp: 'J-ourney', fetch: f.fetch, beforeAttempt: (op) => tryConsumeTourCall(db, op, 1) });
    await client.call('tatsCnctrRatedList', { signguCd: '26350' });
    await expect(client.call('tatsCnctrRatedList', { signguCd: '26350' })).rejects.toMatchObject({ kind: 'budget' });
    expect(f.calls).toHaveLength(1);
    expect(await tourCallsToday(db)).toBe(1);
  });

  it('한도 초과(XML) 응답이면 다시 부르지 않고 fatal 오류를 내며, 오류 문구에 키·요청 주소가 없음', async () => {
    const f = fakeFetch(QUOTA_XML);
    const client = createTourClient({ baseUrl: BASE, serviceKey: KEY, mobileApp: 'J-ourney', fetch: f.fetch });
    const err = await client.call('tatsCnctrRatedList', { signguCd: '26350' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TourApiError);
    expect(err).toMatchObject({ kind: 'fatal' });
    expect((err as Error).message).toContain('22');
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).not.toMatch(/serviceKey|apis\.data\.go\.kr/);
    expect(f.calls).toHaveLength(1);
  });
});
