import type { RouteDay } from '../meeting/types.ts';
import type { MemberRef } from '../meeting/view.ts';
import { dateLabel, weekdayKo } from '../trip/dateRange.ts';
import { dayRows } from './chosenPlan.ts';
import type { TripTimes } from './planTimes.ts';

/**
 * 일정 글 공유(11/3 결정: 일정 탭 제목 옆 '공유'). 날짜별로 시각·장소(종류)를 한 줄씩 적고, 앞 곳에서 오는 이동은 그 사이에 적는다.
 * 시각은 일정 탭과 같이 이동 시간을 이어 붙여 짐작한 값에, 이 폰에서 바꿔 저장한 시각(times)을 얹는다.
 */
export function planShareText(title: string, route: RouteDay[], members: MemberRef[], times: TripTimes = {}): string {
  const lines = [`[J-ourney] ${title} 일정`];
  for (const day of route) {
    lines.push('', day.date !== undefined ? `${day.day}일차 · ${dateLabel(day.date)}` : `${day.day}일차`);
    for (const row of dayRows({ route, members }, day.day, '', times[day.day] ?? {})) {
      if (row.moveLabel !== undefined) lines.push(`  └ ${row.moveLabel}`);
      lines.push(`${row.time} ${row.title} (${row.category})`);
    }
  }
  return lines.join('\n');
}

/** 이미지 공유 판에 그릴 것(planShareSheet). */
export type ShareSheet = {
  title: string;
  /** "11월 15일 (토) ~ 16일 (일) · 4명". 날짜·인원을 모르면 그 부분을 뺀다(둘 다 모르면 빈 글) */
  meta: string;
  days: { key: string; label: string; date: string | null; lines: { time: string; text: string }[] }[];
};

/** "11월 15일 (토) ~ 16일 (일)". 달이 바뀌면 끝 날짜에도 달을 적는다. */
function dateSpan(first: string, last: string): string {
  if (first === last) return dateLabel(first);
  if (first.slice(0, 7) !== last.slice(0, 7)) return `${dateLabel(first)} ~ ${dateLabel(last)}`;
  return `${dateLabel(first)} ~ ${Number(last.slice(8, 10))}일 (${weekdayKo(last)})`;
}

/**
 * 일정 이미지 공유 판(11/3 시안 B: 짧은 표). 모든 날을 날짜별로 시각과 장소만 적고 이동은 뺀다.
 * 관광이 아닌 곳(점심·저녁·숙소·야경)만 이름 뒤에 종류를 붙인다. 시각은 글 공유와 같다.
 */
export function planShareSheet(title: string, route: RouteDay[], members: MemberRef[], times: TripTimes = {}): ShareSheet {
  const dates = route.flatMap((d) => (d.date === undefined ? [] : [d.date]));
  const meta = [
    ...(dates.length > 0 ? [dateSpan(dates[0]!, dates[dates.length - 1]!)] : []),
    ...(members.length > 0 ? [`${members.length}명`] : []),
  ].join(' · ');
  return {
    title,
    meta,
    days: route.map((day) => ({
      key: String(day.day),
      label: `${day.day}일차`,
      date: day.date === undefined ? null : dateLabel(day.date),
      lines: dayRows({ route, members }, day.day, '', times[day.day] ?? {}).map((row) => ({
        time: row.time,
        text: row.category === '관광' ? row.title : `${row.title} (${row.category})`,
      })),
    })),
  };
}
