import { addDays, daysBetween, weekdayKo } from './dateRange.ts';

/** 화면에서 적는 예약한 장소 한 칸. 날짜(YYYY-MM-DD)·시각(HH:MM)은 고르기 전에는 null */
export type BookedPlaceDraft = { name: string; date: string | null; time: string | null };
/** 예약한 장소의 날짜·시각. 서버는 이름만 받아서 이 폰에만 둔다(예약한 장소 목록과 같은 순서) */
export type BookedTime = { date: string; time: string };

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** "11/8(토)" */
export function shortDateLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}(${weekdayKo(iso)})`;
}

/** 여행 기간의 날들(1일차부터). 예약 날짜를 고를 목록 */
export function tripDays(start: string, end: string): { iso: string; label: string }[] {
  const span = daysBetween(start, end);
  if (!(span >= 0)) return [];
  return Array.from({ length: span + 1 }, (_, i) => {
    const iso = addDays(start, i);
    return { iso, label: `${i + 1}일차 · ${shortDateLabel(iso)}` };
  });
}

/** 여행 날짜를 바꿔 기간 밖이 된 예약 날짜는 비운다(다시 고르게). */
export function keepInRange(drafts: BookedPlaceDraft[], start: string, end: string): BookedPlaceDraft[] {
  return drafts.map((d) => (d.date !== null && (d.date < start || d.date > end) ? { ...d, date: null } : d));
}

/**
 * 회의 시작 전 검사: 이름을 적은 칸은 날짜(여행 기간 안)·시각을 꼭 정해야 한다(11/3 결정). 이름이 빈 칸은 없는 것으로 본다.
 * 통과하면 서버로 보낼 이름과 이 폰에 둘 날짜·시각을 같은 순서로 돌려준다.
 */
export function checkBookedPlaces(
  drafts: BookedPlaceDraft[],
  start: string,
  end: string,
): { ok: true; names: string[]; times: BookedTime[] } | { ok: false; error: string } {
  const names: string[] = [];
  const times: BookedTime[] = [];
  for (const d of drafts) {
    const name = d.name.trim();
    if (name === '') continue;
    if (d.date === null || d.time === null || !HHMM.test(d.time)) return { ok: false, error: '예약한 장소의 날짜와 시각을 정해 주세요.' };
    if (d.date < start || d.date > end) return { ok: false, error: '예약한 장소의 날짜는 여행 기간 안에서 골라 주세요.' };
    names.push(name);
    times.push({ date: d.date, time: d.time });
  }
  return { ok: true, names, times };
}

/** 저장해 둔 조건(이름 + 이 폰의 날짜·시각)으로 화면 칸을 다시 만든다. 날짜·시각을 모르면 비워 둔다. */
export function draftsOf(names: string[] | undefined, times: BookedTime[] | undefined): BookedPlaceDraft[] {
  return (names ?? []).map((name, i) => ({ name, date: times?.[i]?.date ?? null, time: times?.[i]?.time ?? null }));
}
