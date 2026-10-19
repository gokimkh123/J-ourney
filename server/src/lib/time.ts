const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간(+09:00) ISO 8601 문자열 (명세서 3장 공통 규칙) */
export function nowKst(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

/** 한국 날짜 YYYY-MM-DD */
export const todayKst = (date: Date = new Date()) => nowKst(date).slice(0, 10);
