const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 하루(밀리초) */
export const DAY_MS = 86_400_000;
/** 하루(분) */
export const DAY_MINUTES = 1440;

/** 'HH:MM' → 그날 0시부터 분 */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** 분 → 'HH:MM' (하루를 넘거나 모자라면 그날 안으로 돌려 씀) */
export const clock = (v: number) => {
  const x = ((v % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** 한국 시간(+09:00) ISO 8601 문자열 (명세서 3장 공통 규칙) */
export function nowKst(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

/** 한국 날짜 YYYY-MM-DD */
export const todayKst = (date: Date = new Date()) => nowKst(date).slice(0, 10);
