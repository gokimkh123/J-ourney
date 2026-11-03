import type { RouteDay } from '../meeting/types.ts';
import type { MemberRef } from '../meeting/view.ts';
import { dateLabel } from '../trip/dateRange.ts';
import { dayRows } from './chosenPlan.ts';
import type { TripTimes } from './planTimes.ts';

/**
 * 일정 글 공유(11/3 결정: 일정 탭 제목 옆 '공유'). 날짜별로 시각·장소(종류)를 한 줄씩 적고, 앞 곳에서 오는 이동은 그 사이에 적는다.
 * 시각은 일정 탭과 같이 이동 시간을 이어 붙여 짐작한 값에, 이 폰에서 바꿔 저장한 시각(times)을 얹는다.
 */
export function planShareText(title: string, route: RouteDay[], members: MemberRef[], times: TripTimes = {}): string {
  const lines = [`[여행회의] ${title} 일정`];
  for (const day of route) {
    lines.push('', day.date !== undefined ? `${day.day}일차 · ${dateLabel(day.date)}` : `${day.day}일차`);
    for (const row of dayRows({ route, members }, day.day, '', times[day.day] ?? {})) {
      if (row.moveLabel !== undefined) lines.push(`  └ ${row.moveLabel}`);
      lines.push(`${row.time} ${row.title} (${row.category})`);
    }
  }
  lines.push('', '시각은 이동 시간으로 짐작했어요.');
  return lines.join('\n');
}
