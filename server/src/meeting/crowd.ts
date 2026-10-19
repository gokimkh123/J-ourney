import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { crowdFetches, crowdForecasts } from '../db/schema.js';
import { todayKst } from '../lib/time.js';
import type { TourClient } from '../tour/client.js';
import { placeMatcher, type MatchablePlace } from './match.js';

/** 집중률 예측 기능 이름 (TatsCnctrRateService) */
export const CROWD_OPERATION = 'tatsCnctrRatedList';
/** 예측은 조회한 날부터 30일치만 있음 */
export const CROWD_WINDOW_DAYS = 30;
const PAGE = 1000;

const DAY_MS = 86400000;

/** 같은 날 같은 구·군을 동시에 받으려는 요청은 먼저 시작한 호출을 함께 기다림 (중복 호출 방지, 끝나면 지움) */
const inflight = new Map<string, Promise<void>>();
const ymd = (d: string) => d.replaceAll('-', '');
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export interface CrowdResult {
  /** contentId → 여행 날짜들의 집중률 평균 (0–100, 가장 붐빌 때 100). 예측이 없는 장소는 없음 */
  scores: Map<string, number>;
  /** 오늘 새로 받은 구·군과 이미 받아 둔 구·군 */
  fetched: string[];
  cached: string[];
  /** 여행 날짜가 30일 밖이면 'out_of_window', 받다가 멈추면 오류 문구 */
  note: string | null;
}

/**
 * 여행 지역 구·군의 집중률 예측을 받아(구·군마다 하루 1회, 같은 날은 DB에서 다시 씀) 장소에 붙임
 * client가 없으면 받아 둔 것만 씀
 */
export async function crowd(
  db: Db,
  client: TourClient | null,
  opts: { regionCode: string; districtCodes: readonly string[]; dates: readonly string[]; places: readonly MatchablePlace[]; regionWords: readonly string[]; today?: string },
): Promise<CrowdResult> {
  const today = opts.today ?? todayKst();
  const last = addDays(today, CROWD_WINDOW_DAYS - 1);
  const dates = opts.dates.filter((d) => d >= today && d <= last);
  const result: CrowdResult = { scores: new Map(), fetched: [], cached: [], note: null };
  if (!dates.length) return { ...result, note: 'out_of_window' };

  const signgus = opts.districtCodes.map((d) => `${opts.regionCode}${d}`);
  const done = new Set(
    (await db.select({ s: crowdFetches.signguCd }).from(crowdFetches).where(and(eq(crowdFetches.fetchedOn, today), inArray(crowdFetches.signguCd, signgus)))).map((r) => r.s),
  );
  for (const sg of signgus) {
    if (done.has(sg)) {
      result.cached.push(sg);
      continue;
    }
    if (!client) continue;
    const key = `${today}|${sg}`;
    let job = inflight.get(key);
    if (!job) {
      job = fetchDistrict(db, client, opts.regionCode, sg, today).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    try {
      await job;
    } catch (err) {
      result.note = err instanceof Error ? err.message : String(err);
      break;
    }
    result.fetched.push(sg);
  }

  const rows = await db
    .select()
    .from(crowdForecasts)
    .where(and(inArray(crowdForecasts.signguCd, signgus), inArray(crowdForecasts.baseYmd, dates.map(ymd))));
  const match = placeMatcher(opts.places, opts.regionWords);
  const sum = new Map<string, { total: number; n: number }>();
  for (const r of rows) {
    const id = match(r.spotName, r.signguCd.slice(opts.regionCode.length) || null);
    if (!id) continue;
    const s = sum.get(id) ?? { total: 0, n: 0 };
    s.total += r.rate;
    s.n += 1;
    sum.set(id, s);
  }
  result.scores = new Map([...sum].map(([id, s]) => [id, Math.round(s.total / s.n)]));
  return result;
}

/** 구·군 하나의 30일 예측을 받아 저장함 (지난 날짜는 지우고, 받은 날을 남겨 그날은 다시 부르지 않음) */
async function fetchDistrict(db: Db, client: TourClient, regionCode: string, sg: string, today: string): Promise<void> {
  const items: { spot: string; day: string; rate: number }[] = [];
  for (let page = 1; ; page++) {
    const res = await client.call(CROWD_OPERATION, { numOfRows: PAGE, pageNo: page, areaCd: regionCode.slice(0, 2), signguCd: sg });
    for (const it of res.items) {
      const rate = Number(it.cnctrRate);
      if (it.tAtsNm && it.baseYmd && Number.isFinite(rate)) items.push({ spot: it.tAtsNm.trim(), day: it.baseYmd, rate });
    }
    if (page * PAGE >= res.totalCount || !res.items.length) break;
  }
  await db.delete(crowdForecasts).where(and(eq(crowdForecasts.signguCd, sg), lt(crowdForecasts.baseYmd, ymd(today))));
  const rows = [...new Map(items.map((i) => [`${i.day}|${i.spot}`, { signguCd: sg, baseYmd: i.day, spotName: i.spot, rate: i.rate }])).values()];
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(crowdForecasts).values(rows.slice(i, i + 500)).onConflictDoUpdate({ target: [crowdForecasts.signguCd, crowdForecasts.baseYmd, crowdForecasts.spotName], set: { rate: sql`excluded.rate` } });
  }
  await db.insert(crowdFetches).values({ signguCd: sg, fetchedOn: today, rows: rows.length }).onConflictDoNothing();
}
