import test from 'node:test';
import assert from 'node:assert/strict';

import type { RouteDay, RouteStop } from '../meeting/types.ts';
import { planShareText } from './planShare.ts';

const sight = (itemId: string, name: string, minutes: number | null = null): RouteStop => ({
  itemId,
  name,
  lat: 35,
  lng: 129,
  placeId: `plc_${itemId}`,
  ...(minutes !== null && { moveFromPrev: { mode: 'bus', minutes, distanceM: 2000, fareWon: 1500 } }),
} as RouteStop);
const meal = (itemId: string, name: string, when: 'lunch' | 'dinner'): RouteStop =>
  ({ itemId, name, lat: 35, lng: 129, placeId: `plc_${itemId}`, kind: 'food', meal: when }) as RouteStop;

const ROUTE: RouteDay[] = [
  { day: 1, date: '2026-11-14', stops: [sight('s1', '국제시장'), sight('s2', '감천문화마을', 24), meal('f1', '자갈치 식당', 'lunch')] },
  { day: 2, stops: [sight('s3', '해운대')] },
];

test('날짜별로 시각·장소(종류)를 적고, 이동은 그 사이에 적는다', () => {
  const lines = planShareText('부산 1박 2일', ROUTE, []).split('\n');
  assert.equal(lines[0], '[여행회의] 부산 1박 2일 일정');
  assert.equal(lines[2], '1일차 · 11월 14일 (토)');
  assert.match(lines[3]!, /^09:00 국제시장 \(관광\)$/);
  // 두 번째 곳 앞에 앞 곳에서 오는 이동
  assert.match(lines[4]!, /^ {2}└ .*24분/);
  assert.match(lines[5]!, /^\d\d:\d\d 감천문화마을 \(관광\)$/);
  assert.match(lines[6]!, /^\d\d:\d\d 자갈치 식당 \(점심\)$/);
  // 날짜가 없는 날은 일차만
  assert.equal(lines[8], '2일차');
  assert.equal(lines.at(-1), '시각은 이동 시간으로 짐작했어요.');
});

test('이 폰에서 바꾼 시각을 얹는다', () => {
  const text = planShareText('부산', ROUTE, [], { 1: { plc_s1: 10 * 60 } });
  assert.match(text, /\n10:00 국제시장 \(관광\)\n/);
});
