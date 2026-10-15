/**
 * TourAPI 상세의 휴무일·영업시간 문장을 규칙으로 읽음
 * 흔한 표현(매주 월요일, 연중무휴, 09:00~18:00, 계절·달별 시간)만 읽고, 못 읽으면 'unknown'·null로 두어 후보에서 빼지 않음
 */

const WEEKDAYS = '일월화수목금토'; // Date.getUTCDay() 순서

/** YYYY-MM-DD를 날짜로 (한국 날짜를 그대로 씀) */
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

const strip = (text: string) => text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export type ClosedCheck = 'open' | 'closed' | 'unknown';

/** 그날 쉬는지 판단함. 명절 휴무처럼 특정 날만 쉬는 곳은 평일에는 연다고 봄 */
export function closedOn(raw: string | null | undefined, ymd: string): ClosedCheck {
  const text = strip(raw ?? '');
  if (!text) return 'unknown';
  const date = toDate(ymd);
  const day = WEEKDAYS[date.getUTCDay()];
  if (/연중\s*무휴|휴무\s*없음|무휴|휴일\s*없음/.test(text)) return 'open';
  const nth = text.match(/(첫째|둘째|셋째|넷째|다섯째|마지막)/g);
  const days = [...text.matchAll(/([일월화수목금토])요일/g)].map((m) => m[1]);
  if (nth && days.length) {
    const order = ['첫째', '둘째', '셋째', '넷째', '다섯째'];
    const week = Math.floor((date.getUTCDate() - 1) / 7);
    const last = date.getUTCDate() + 7 > new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const hit = nth.some((n) => (n === '마지막' ? last : order.indexOf(n) === week));
    return days.includes(day) && hit ? 'closed' : 'open';
  }
  if (days.length) return days.includes(day) ? 'closed' : 'open';
  if (/설|추석|명절|신정|1월\s*1일|공휴일/.test(text)) return 'open';
  return 'unknown';
}

export interface OpenHours {
  /** 0시부터의 분 (24:00은 1440) */
  open: number;
  close: number;
}

const minutes = (h: string, m: string) => Number(h) * 60 + Number(m);

/** '3월~10월' · '11, 12, 1, 2월'을 달 목록으로 */
function monthsOf(seg: string): Set<number> {
  const nums = [...seg.matchAll(/(\d{1,2})/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 12);
  if (/~|-/.test(seg) && nums.length === 2) {
    const [a, b] = nums;
    const out = new Set<number>();
    for (let mo = a; ; mo = (mo % 12) + 1) {
      out.add(mo);
      if (mo === b) break;
    }
    return out;
  }
  return new Set(nums);
}

/**
 * 그 달의 영업시간. '상시'는 하루 종일, 계절·달 구간이 있으면 그 달 구간, 없으면 첫 시간 구간
 * 성수기에만 시간을 적은 곳(예: '매년 6월~9월 09:00~18:00')은 그 밖의 달에 null (시간 제한 없이 봄)
 */
export function hoursOn(raw: string | null | undefined, month: number): OpenHours | null {
  const text = strip(raw ?? '');
  if (!text) return null;
  if (/상시|24시간/.test(text) && !/\d{1,2}:\d{2}\s*[~\-–]/.test(text)) return { open: 0, close: 1440 };
  const range = /(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/;
  const seasons = [...text.matchAll(/\(([^)]*월[^)]*)\)\]?\s*(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/g)];
  if (seasons.length) {
    const hit = seasons.find((m) => monthsOf(m[1]).has(month));
    return hit ? { open: minutes(hit[2], hit[3]), close: minutes(hit[4], hit[5]) } : null;
  }
  const season = text.match(/(\d{1,2})월\s*~\s*(\d{1,2})월\s*(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
  if (season) {
    return monthsOf(`${season[1]}~${season[2]}`).has(month) ? { open: minutes(season[3], season[4]), close: minutes(season[5], season[6]) } : null;
  }
  const m = text.match(range);
  return m ? { open: minutes(m[1], m[2]), close: minutes(m[3], m[4]) } : null;
}

/** 화면·LLM에 보여 줄 짧은 영업시간 문구 */
export function hoursLabel(raw: string | null | undefined, month: number): string | null {
  const h = hoursOn(raw, month);
  if (!h) return null;
  if (h.open === 0 && h.close === 1440) return '상시';
  const f = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return `${f(h.open)}~${f(h.close)}`;
}
