import assert from 'node:assert/strict';
import test from 'node:test';

import type { MoveLeg, RouteDay, RouteStop } from '../meeting/types.ts';
import { chosenPlanStore, dayOfKey, dayRows, routeDayTabs, stopTimes } from './chosenPlan.ts';

function leg(minutes: number | null, extra: Partial<MoveLeg> = {}): MoveLeg {
  return { mode: 'bus', minutes, distanceM: 1500, fareWon: null, source: 'kakao_route', routeUrl: null, ...extra };
}

function stop(id: string, name: string, extra: Partial<RouteStop> = {}): RouteStop {
  return { itemId: `i_${id}`, placeId: id, name, lat: 35.1, lng: 129.1, kind: 'sight', moveFromPrev: null, ...extra };
}

const members = [
  { memberId: 'u1', name: '민수', color: '#F97316' },
  { memberId: 'u2', name: '지은', color: '#EC4899' },
];

test('시각은 9시에 시작해 머무는 시간과 이동 시간을 이어 붙인다', () => {
  const stops = [stop('a', 'a'), stop('b', 'b', { moveFromPrev: leg(20) }), stop('c', 'c', { moveFromPrev: leg(10) })];
  // 9:00, 9:00+90+20=10:50, 10:50+90+10=12:30
  assert.deepEqual(stopTimes(stops), ['09:00', '10:50', '12:30']);
});

test('점심은 12시, 저녁은 18시보다 일찍 시작하지 않는다', () => {
  const stops = [
    stop('a', 'a'),
    stop('b', '점심집', { kind: 'food', meal: 'lunch', moveFromPrev: leg(5) }),
    stop('c', 'c', { moveFromPrev: leg(5) }),
    stop('d', '저녁집', { kind: 'food', meal: 'dinner', moveFromPrev: leg(5) }),
  ];
  const times = stopTimes(stops);
  assert.equal(times[1], '12:00');
  assert.equal(times[3], '18:00');
});

test('이동 시간을 모르는 구간은 15분으로 짐작하고, 하루를 넘기지 않는다', () => {
  assert.deepEqual(stopTimes([stop('a', 'a'), stop('b', 'b', { moveFromPrev: leg(null) })]), ['09:00', '10:45']);
  const many = Array.from({ length: 12 }, (_, i) => stop(`s${i}`, `s${i}`, { moveFromPrev: leg(30) }));
  assert.equal(stopTimes(many).at(-1), '23:59');
});

test('일정 줄: 종류별 분류, 구성원 색, 이동 안내', () => {
  const route: RouteDay[] = [
    {
      day: 1,
      stops: [
        stop('a', '감천문화마을', { mustFor: ['u1'], likedBy: ['u1', 'u2'] }),
        stop('b', '자갈치시장', { kind: 'food', meal: 'lunch', likedBy: ['u2'], moveFromPrev: leg(18, { mode: 'subway', fareWon: 1500 }) }),
        stop('c', '전망대', { night: true, moveFromPrev: leg(null, { distanceM: 2400 }) }),
        stop('d', '호텔', { kind: 'lodging', moveFromPrev: leg(12) }),
      ],
    },
  ];
  const rows = dayRows({ route, members }, 1, '#000000');
  assert.deepEqual(rows.map((r) => r.category), ['관광', '점심', '야경', '숙소']);
  assert.deepEqual(rows[0]!.forMembers, [
    { name: '민수', color: '#F97316' },
    { name: '지은', color: '#EC4899' },
  ]);
  assert.equal(rows[0]!.color, '#F97316');
  assert.equal(rows[3]!.color, '#000000');
  assert.equal(rows[0]!.moveLabel, undefined);
  assert.equal(rows[1]!.moveLabel, '지하철 18분 · 1,500원');
  assert.equal(rows[2]!.moveLabel, '직선 2.4km');
  assert.equal(rows[1]!.kind, 'food');
});

test('없는 날은 빈 목록이다', () => {
  assert.deepEqual(dayRows({ route: [], members }, 3, '#000'), []);
});

test('날짜 탭은 일차 순이고 키에서 일차를 되돌린다', () => {
  const route: RouteDay[] = [
    { day: 2, stops: [] },
    { day: 1, stops: [] },
  ];
  assert.deepEqual(routeDayTabs(route), [
    { key: 'day-1', label: '1일차' },
    { key: 'day-2', label: '2일차' },
  ]);
  assert.equal(dayOfKey('day-2'), 2);
});

test('고른 안 저장소는 처음에 비어 있다', () => {
  assert.equal(chosenPlanStore.get(), null);
});
