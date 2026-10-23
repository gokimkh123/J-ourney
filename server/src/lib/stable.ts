/** 키 순서와 상관없이 같은 값이면 같은 글자 (JSON). LLM 녹화 지문과 지난 회의 조건 비교에 씀 */
export const stableJson = (v: unknown) =>
  JSON.stringify(v ?? null, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
