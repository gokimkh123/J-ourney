/** 외부 자료(연관 관광지·집중률)의 장소 이름을 우리 장소(TourAPI contentid)에 맞추는 규칙 */

/** 괄호 속 말·띄어쓰기·문장 부호·지역 이름을 지운 비교용 이름 */
export function normName(name: string, regionWords: readonly string[] = []): string {
  let s = name.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[\s·\-_,.'"]/g, '');
  for (const w of regionWords) if (w && s.startsWith(w) && s.length > w.length + 1) s = s.slice(w.length);
  return s;
}

export interface MatchablePlace {
  contentId: string;
  title: string;
  districtCode: string | null;
}

/**
 * 같은 구·군 안에서 이름이 같으면 그 장소, 아니면 한쪽 이름이 다른 쪽을 품고(3자 이상) 후보가 하나뿐일 때만 그 장소
 * 맞는 장소가 없거나 여럿이면 null (엉뚱한 장소에 값을 붙이지 않음)
 */
export function placeMatcher(places: readonly MatchablePlace[], regionWords: readonly string[] = []) {
  const byDistrict = new Map<string, { id: string; key: string }[]>();
  for (const p of places) {
    const d = p.districtCode ?? '';
    const list = byDistrict.get(d) ?? [];
    list.push({ id: p.contentId, key: normName(p.title, regionWords) });
    byDistrict.set(d, list);
  }
  return (name: string, districtCode: string | null): string | null => {
    const key = normName(name, regionWords);
    if (key.length < 2) return null;
    const pool = districtCode !== null ? (byDistrict.get(districtCode) ?? []) : [...byDistrict.values()].flat();
    const exact = pool.filter((p) => p.key === key);
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) return null;
    const part = pool.filter((p) => Math.min(p.key.length, key.length) >= 3 && (p.key.includes(key) || key.includes(p.key)));
    return part.length === 1 ? part[0].id : null;
  };
}
