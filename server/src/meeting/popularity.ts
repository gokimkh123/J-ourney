import { and, desc, eq, gt, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { placeRelations, relatedFetches } from '../db/schema.js';
import { placeMatcher, type MatchablePlace } from './match.js';

/** 연관 관광지 순위(1–50)를 점수로 바꿀 때 쓰는 기준 (1위 50점 … 50위 1점) */
const RANK_BASE = 51;

export interface PopularityResult {
  /** contentId → 인기도 0–100 (지역 안 최고 = 100). 자료로 맞추지 못한 장소는 없음(null로 다룸) */
  scores: Map<string, number>;
  /** 쓴 달 (YYYYMM). 연관 관광지 자료가 없으면 null */
  baseYm: string | null;
  matched: number;
}

/**
 * 연관 관광지(티맵 함께 찾은 장소)로 인기도를 계산함
 * 여행하는 달의 작년 자료를 쓰고, 없으면 가장 최근 달을 씀 (계절마다 인기 장소가 다름)
 */
export async function popularity(
  db: Db,
  opts: { regionCode: string; tripMonth: string; places: readonly MatchablePlace[]; regionWords: readonly string[] },
): Promise<PopularityResult> {
  const months = (
    await db
      .selectDistinct({ ym: relatedFetches.baseYm })
      .from(relatedFetches)
      .where(and(like(relatedFetches.signguCd, `${opts.regionCode}%`), gt(relatedFetches.rows, 0)))
      .orderBy(desc(relatedFetches.baseYm))
  ).map((r) => r.ym);
  const lastYear = `${Number(opts.tripMonth.slice(0, 4)) - 1}${opts.tripMonth.slice(4, 6)}`;
  const baseYm = months.includes(lastYear) ? lastYear : (months[0] ?? null);
  if (!baseYm) return { scores: new Map(), baseYm: null, matched: 0 };

  const rows = await db
    .select({ name: placeRelations.rlteTatsNm, signgu: placeRelations.rlteSignguCd, rank: placeRelations.rlteRank })
    .from(placeRelations)
    .where(and(eq(placeRelations.baseYm, baseYm), like(placeRelations.signguCd, `${opts.regionCode}%`)));

  // 같은 장소가 여러 관광지의 '함께 찾은 곳'에 나올수록, 순위가 높을수록 점수가 큼
  const raw = new Map<string, number>();
  const match = placeMatcher(opts.places, opts.regionWords);
  for (const r of rows) {
    if (!r.signgu?.startsWith(opts.regionCode)) continue;
    const id = match(r.name, r.signgu.slice(opts.regionCode.length) || null);
    if (!id) continue;
    raw.set(id, (raw.get(id) ?? 0) + Math.max(1, RANK_BASE - (r.rank ?? RANK_BASE - 1)));
  }
  const top = Math.max(0, ...raw.values());
  const scores = new Map([...raw].map(([id, v]) => [id, Math.round((v / top) * 100)]));
  return { scores, baseYm, matched: scores.size };
}
