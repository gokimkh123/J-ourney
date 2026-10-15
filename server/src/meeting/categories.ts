import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, places } from '../db/schema.js';

/** 회의 후보로 쓰는 장소 유형 (TourAPI 콘텐츠 유형): 축제공연행사·관광지·문화시설·레포츠·음식점·쇼핑 */
export const CANDIDATE_TYPES = [15, 12, 14, 28, 39, 38] as const;

/** 회의 후보가 아닌 분류(숙박·추천코스)는 성향 LLM의 분류표에서 뺌 */
export const RULE_CATEGORY_SKIP: readonly string[] = ['AC', 'C01'];

export interface RuleCategory {
  code: string;
  /** 중분류 이름 (예: 웰니스관광) */
  group: string;
  /** 소분류 이름 (예: 온천 / 사우나 / 스파) */
  name: string;
}

/**
 * 성향 LLM이 '꼭 지킬 것'의 종류를 고를 분류표 (코드 순)
 * 회의 후보가 될 수 있는 장소(공개·지역 코드 있음·후보 유형)가 한 곳이라도 쓰는 분류만 보냄: 전국에 장소가 없는 분류를 고르면 어디에도 맞지 않음
 */
export async function ruleCategories(db: Db): Promise<RuleCategory[]> {
  const used = db
    .selectDistinct({ code: places.lcls3 })
    .from(places)
    .where(and(eq(places.visible, true), isNotNull(places.regionCode), inArray(places.contentTypeId, [...CANDIDATE_TYPES])));
  const rows = await db
    .select({ code: categories.code, group: categories.name2, name: categories.name3 })
    .from(categories)
    .where(inArray(categories.code, used))
    .orderBy(asc(categories.code));
  return rows.filter((r) => !RULE_CATEGORY_SKIP.some((p) => r.code.startsWith(p)));
}
