/** 시·도 이름에서 떼어 짧게 부르는 꼬리말 (부산광역시 → 부산) */
const REGION_SUFFIX = /(통합특별시|특별자치시|특별자치도|특별시|광역시|도)$/;

/**
 * 시·도의 짧은 이름 (경상남도 → 경남, 부산광역시 → 부산, 전남광주통합특별시 → 전남광주). 공식 지역 이름만 다룸 (관광공사 자료의 장소 이름에서 지역 이름을 뗄 때)
 * 사람이 쓴 여행지·지역 말은 코드가 비교하지 않음 (10/29: 여행지는 destination.ts, 지역 조건은 areas.ts의 LLM이 목록에서 고름)
 */
export function shortRegionName(name: string): string {
  const m = name.match(/^(경상|충청|전라)(남|북)도$/);
  return m ? m[1][0] + m[2] : name.replace(REGION_SUFFIX, '');
}

/**
 * 구가 있는 시(예: 전주시)를 고르면 그 아래 구(전주시 완산구·덕진구)도 함께 넣음: 장소 자료는 구 코드에 붙어 있어 시 코드만으로는 장소가 없음 (10/29 시험: 포항·전주·창원·청주·수원)
 * 공식 지역 표의 코드(앞 두 자리)와 이름(시 이름 + 띄어쓰기로 시작)만 봄
 */
export function withSubDistricts(codes: readonly string[], rows: readonly { districtCode: string; districtName: string }[]): string[] {
  const out = new Set(codes);
  for (const code of codes) {
    const parent = rows.find((r) => r.districtCode === code);
    if (!parent) continue;
    for (const r of rows) if (r.districtCode !== code && r.districtCode.slice(0, 2) === code.slice(0, 2) && r.districtName.startsWith(`${parent.districtName} `)) out.add(r.districtCode);
  }
  return [...out];
}
