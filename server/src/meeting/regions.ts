import type { Db } from '../db/client.js';
import { regions } from '../db/schema.js';
import type { ResolvedDestination } from './types.js';

/** 시·도 이름에서 떼어 짧게 부르는 꼬리말 (부산광역시 → 부산) */
const REGION_SUFFIX = /(통합특별시|특별자치시|특별자치도|특별시|광역시|도)$/;
/** 시·군·구 이름의 꼬리말 (해운대구 → 해운대) */
const DISTRICT_SUFFIX = /(시|군|구)$/;

/** 시·도의 짧은 이름 (경상남도 → 경남, 부산광역시 → 부산, 전남광주통합특별시 → 전남광주) */
export function shortRegionName(name: string): string {
  const m = name.match(/^(경상|충청|전라)(남|북)도$/);
  return m ? m[1][0] + m[2] : name.replace(REGION_SUFFIX, '');
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 시·군·구 이름이 맞는지: 같거나, 꼬리말(시·군·구)을 뗀 이름이 같거나, 두 글자 이상으로 시작이 같음 (해운대 → 해운대구) */
const districtHit = (word: string, name: string) => {
  const w = squash(word);
  const n = squash(name);
  return w === n || w === squash(name.replace(DISTRICT_SUFFIX, '')) || (w.length >= 2 && n.startsWith(w));
};

/** 시·군·구 이름 → 그 이름에 맞는 법정동 코드 (주어진 지역 표 안에서만 찾음) */
export const districtsNamed = (word: string, rows: readonly { districtCode: string; districtName: string }[]) =>
  rows.filter((r) => districtHit(word, r.districtName)).map((r) => r.districtCode);

export class DestinationError extends Error {}

/**
 * 회의 조건의 목적지 글자를 법정동 코드로 바꿈
 * '부산' → 부산 전체, '부산 해운대구'·'해운대' → 해운대구, '중구'처럼 여러 시·도에 있으면 오류(후보를 알려 줌)
 */
export async function resolveDestination(db: Db, input: string): Promise<ResolvedDestination> {
  const all = await db.select().from(regions);
  if (!all.length) throw new Error('지역 표가 비어 있음 (법정동 코드표를 먼저 받아야 함)');
  const text = input.trim().replace(/\s+/g, ' ');
  const regionList = [...new Map(all.map((r) => [r.regionCode, r.regionName])).entries()].map(([code, name]) => ({ code, name }));
  const exactRegion = (word: string, name: string) => word === name || word === shortRegionName(name);
  const isRegion = (word: string, name: string) => exactRegion(word, name) || (word.length >= 2 && shortRegionName(name).includes(word));

  const [first, ...rest] = text.split(' ');
  const regionHits = regionList.filter((r) => isRegion(first, r.name));
  if (regionHits.length > 1) throw new DestinationError(`'${first}'에 해당하는 시·도가 여럿임: ${regionHits.map((r) => r.name).join(', ')}`);
  if (regionHits.length === 1) {
    const region = regionHits[0];
    if (!rest.length) {
      // 시·도 이름의 일부이면서 다른 시·도의 시·군·구 이름이기도 하면 고르게 함 (광주 → 전남광주통합특별시 / 경기도 광주시)
      const elsewhere = exactRegion(first, region.name) ? [] : all.filter((r) => r.regionCode !== region.code && districtHit(first, r.districtName));
      if (elsewhere.length) {
        const names = [region.name, ...new Set(elsewhere.map((h) => `${h.regionName} ${h.districtName}`))].slice(0, 6);
        throw new DestinationError(`같은 이름의 지역이 여러 곳에 있음 '${first}': ${names.join(', ')} (시·도 이름을 함께 적어 주세요)`);
      }
      return { regionCode: region.code, regionName: region.name, districtCodes: [], label: region.name };
    }
    const word = rest.join(' ');
    const hits = all.filter((r) => r.regionCode === region.code && districtHit(word, r.districtName));
    if (!hits.length) throw new DestinationError(`${region.name}에서 '${word}'를 찾지 못함`);
    return { regionCode: region.code, regionName: region.name, districtCodes: hits.map((h) => h.districtCode), label: `${region.name} ${hits.map((h) => h.districtName).join(', ')}` };
  }

  const hits = all.filter((r) => districtHit(text, r.districtName));
  const byRegion = [...new Set(hits.map((h) => h.regionCode))];
  if (!hits.length) throw new DestinationError(`'${text}'에 해당하는 지역을 찾지 못함 (예: 부산, 부산 해운대구, 제주)`);
  if (byRegion.length > 1) {
    const names = [...new Set(hits.map((h) => `${h.regionName} ${h.districtName}`))].slice(0, 6);
    throw new DestinationError(`같은 이름의 지역이 여러 곳에 있음 '${text}': ${names.join(', ')} (시·도 이름을 함께 적어 주세요)`);
  }
  const regionName = hits[0].regionName;
  return { regionCode: byRegion[0], regionName, districtCodes: hits.map((h) => h.districtCode), label: `${regionName} ${hits.map((h) => h.districtName).join(', ')}` };
}
