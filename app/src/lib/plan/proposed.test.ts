import assert from 'node:assert/strict';
import test from 'node:test';

import { initialMeetingState } from '../meeting/reducer.ts';
import type { MeetingState, MoveLeg, RouteDay, RouteStop } from '../meeting/types.ts';
import { durationLabel, moveMinutesOf, noticeOf, planChoices, proposedPlans } from './proposed.ts';

function leg(minutes: number | null): MoveLeg {
  return { mode: 'bus', minutes, distanceM: 1000, fareWon: null, source: 'kakao_route', routeUrl: null };
}

function stop(id: string, name: string, extra: Partial<RouteStop> = {}): RouteStop {
  return { itemId: `i_${id}`, placeId: id, name, lat: 35, lng: 129, kind: 'sight', moveFromPrev: null, ...extra };
}

function day(n: number, stops: RouteStop[], summary?: RouteDay['summary']): RouteDay {
  return summary === undefined ? { day: n, stops } : { day: n, stops, summary };
}

function stateWith(plans: MeetingState['plans']): MeetingState {
  return { ...initialMeetingState(), phase: 'proposed', plans };
}

const summary = (moveMinutes: number, unknownLegs = 0) => ({ moveMinutes, unknownLegs, spanMinutes: 600, heavy: false });

const A = {
  version: 1,
  label: 'A' as const,
  route: [
    day(1, [stop('p1', '해운대'), stop('p2', '감천문화마을', { moveFromPrev: leg(25) }), stop('p3', '자갈치시장', { moveFromPrev: leg(18) })], summary(43)),
    day(2, [stop('p4', '광안리', { moveFromPrev: leg(30) })], summary(30)),
  ],
  notes: ['1일째 이동 43분'],
};
const B = {
  version: 1,
  label: 'B' as const,
  route: [day(1, [stop('p1', '해운대'), stop('p5', '동래온천', { moveFromPrev: leg(40) }), stop('p6', '태종대', { moveFromPrev: leg(20) })], summary(60, 1))],
};

test('proposedPlans는 라벨이 있는 안만 A, B 순으로 돌려준다', () => {
  const state = stateWith({ pln_b: B, pln_x: { version: 1, route: [] }, pln_a: A });
  assert.deepEqual(
    proposedPlans(state).map((p) => [p.planId, p.label]),
    [
      ['pln_a', 'A'],
      ['pln_b', 'B'],
    ],
  );
});

test('이동 시간은 날짜별 요약 합이고 길찾기 실패 구간이 있으면 approx다', () => {
  assert.deepEqual(moveMinutesOf(A.route), { minutes: 73, approx: false });
  assert.deepEqual(moveMinutesOf(B.route), { minutes: 60, approx: true });
});

test('요약이 없으면 구간 시간을 더하고 시간 없는 구간은 approx로 센다', () => {
  const route = [day(1, [stop('a', 'a'), stop('b', 'b', { moveFromPrev: leg(10) }), stop('c', 'c', { moveFromPrev: leg(null) })])];
  assert.deepEqual(moveMinutesOf(route), { minutes: 10, approx: true });
});

test('시간 표기: 분만, 정각, 시간과 분, 근사', () => {
  assert.equal(durationLabel(55), '55분');
  assert.equal(durationLabel(120), '2시간');
  assert.equal(durationLabel(130), '2시간 10분');
  assert.equal(durationLabel(130, true), '2시간 10분+');
});

test('카드의 대표 장소는 그 안에만 있는 관광지를 먼저 두 곳 고른다', () => {
  const choices = planChoices(stateWith({ pln_a: A, pln_b: B }));
  assert.deepEqual(choices.map((c) => c.label), ['A', 'B']);
  assert.deepEqual(choices[0]!.places, ['감천문화마을', '자갈치시장']);
  assert.deepEqual(choices[1]!.places, ['동래온천', '태종대']);
  assert.equal(choices[0]!.moveLabel, '1시간 13분');
  assert.equal(choices[1]!.moveLabel, '1시간+');
});

test('그 안에만 있는 곳이 모자라면 두 안 모두 가는 곳으로 채우고 식당·숙소는 뺀다', () => {
  const onlyShared = {
    version: 1,
    label: 'B' as const,
    route: [day(1, [stop('p1', '해운대'), stop('f1', '국밥집', { kind: 'food' }), stop('h1', '호텔', { kind: 'lodging' })])],
  };
  const choices = planChoices(stateWith({ pln_a: A, pln_b: onlyShared }));
  assert.deepEqual(choices[1]!.places, ['해운대']);
});

test('안이 하나뿐이어도 카드를 만든다', () => {
  const choices = planChoices(stateWith({ pln_a: A }));
  assert.equal(choices.length, 1);
  assert.deepEqual(choices[0]!.places, ['해운대', '감천문화마을']);
});

test('이동 시간 정보가 전혀 없으면 정보 없음', () => {
  const none = { version: 1, label: 'A' as const, route: [day(1, [stop('a', 'a'), stop('b', 'b', { moveFromPrev: leg(null) })])] };
  assert.equal(planChoices(stateWith({ pln_a: none }))[0]!.moveLabel, '정보 없음');
});

test('안내는 첫 줄만 보이고 나머지는 건수로 줄인다', () => {
  const plans = proposedPlans(stateWith({ pln_a: { ...A, notes: ['첫째', '둘째', '셋째'] } }));
  assert.equal(noticeOf(plans[0]), '첫째 (외 2건)');
  assert.equal(noticeOf(proposedPlans(stateWith({ pln_a: { ...A, notes: ['하나'] } }))[0]), '하나');
  assert.equal(noticeOf(proposedPlans(stateWith({ pln_a: { ...A, notes: [] } }))[0]), null);
  assert.equal(noticeOf(undefined), null);
});
