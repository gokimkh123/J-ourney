import assert from 'node:assert/strict';
import test from 'node:test';

import type { MoveLeg, RouteDay, RouteStop } from '../meeting/types.ts';
import { dayRows, draftDayRows, slotMinutes, stopTimes, timeKeyOf, type TimeSlot } from './chosenPlan.ts';
import { addSight, createDraft, dropRow, removeRow, swapMeal } from './planDraft.ts';

function leg(minutes: number | null): MoveLeg {
  return { mode: 'bus', minutes, distanceM: 1500, fareWon: null, source: 'kakao_route', routeUrl: null };
}

function stop(id: string, extra: Partial<RouteStop> = {}): RouteStop {
  return { itemId: `i_${id}`, placeId: `plc_${id}`, name: `${id} 이름`, lat: 35.1, lng: 129.1, kind: 'sight', moveFromPrev: null, ...extra };
}

const slot = (key: string, extra: Partial<TimeSlot> = {}): TimeSlot => ({ key, kind: 'sight', meal: null, legMinutes: 10, ...extra });
const at = (h: number, m = 0) => h * 60 + m;

test('정한 시각이 없으면 예전 짐작과 같다', () => {
  const stops = [stop('a'), stop('b', { moveFromPrev: leg(20) }), stop('c', { moveFromPrev: leg(10) })];
  assert.deepEqual(stopTimes(stops), ['09:00', '10:50', '12:30']);
  assert.deepEqual(stopTimes(stops, {}), ['09:00', '10:50', '12:30']);
});

test('정한 곳은 그 시각에 시작하고 뒤 곳은 거기서부터 이어 붙는다', () => {
  // 9:00 → b를 11:30으로 → c는 11:30+90+10=13:10
  assert.deepEqual(slotMinutes([slot('a'), slot('b'), slot('c')], { b: at(11, 30) }), [at(9), at(11, 30), at(13, 10)]);
});

test('첫 곳을 정하면 하루가 통째로 밀린다', () => {
  assert.deepEqual(slotMinutes([slot('a'), slot('b')], { a: at(10, 30) }), [at(10, 30), at(12, 10)]);
});

test('앞 곳보다 이르게 정하면 앞 곳 시각에 맞춘다', () => {
  assert.deepEqual(slotMinutes([slot('a'), slot('b')], { a: at(11), b: at(10) }), [at(11), at(11)]);
});

test('정한 시각 뒤에도 점심·저녁은 그 시각 전에는 시작하지 않는다', () => {
  const minutes = slotMinutes([slot('a'), slot('lunch', { kind: 'food', meal: 'lunch' })], { a: at(9, 30) });
  assert.equal(minutes[1], at(12));
});

test('바꾼 시각 열쇠는 장소 id, 숙소는 항목 id', () => {
  assert.equal(timeKeyOf(stop('a')), 'plc_a');
  assert.equal(timeKeyOf(stop('h', { kind: 'lodging' })), 'i_h');
  assert.equal(timeKeyOf({ itemId: 'i_x', name: 'x', lat: 0, lng: 0 }), 'i_x');
});

test('일정 줄은 그날 바꾼 시각을 쓰고 열쇠를 함께 준다', () => {
  const route: RouteDay[] = [{ day: 1, stops: [stop('a'), stop('b', { moveFromPrev: leg(20) })] }];
  const rows = dayRows({ route, members: [] }, 1, '#000', { plc_b: at(14) });
  assert.deepEqual(
    rows.map((r) => [r.time, r.timeKey]),
    [
      ['09:00', 'plc_a'],
      ['14:00', 'plc_b'],
    ],
  );
});

const ROUTE: RouteDay[] = [
  {
    day: 1,
    stops: [
      stop('s1'),
      stop('s2', { moveFromPrev: leg(20) }),
      stop('f1', { kind: 'food', meal: 'lunch', moveFromPrev: leg(10) }),
      stop('s3', { moveFromPrev: leg(30) }),
    ],
  },
];

test('고치는 중에도 평소 모양 그대로: 뺀 곳은 빠지고 시각은 남은 순서로 다시 짐작한다', () => {
  const rows = draftDayRows(removeRow(createDraft(ROUTE, 1), 'i_s2'), 0, [], '#000');
  assert.deepEqual(
    rows.map((r) => r.title),
    ['s1 이름', 'f1 이름', 's3 이름'],
  );
  // s1 9:00 → 점심은 s1 뒤 바뀐 구간(모름 15분)이지만 12시 전에는 시작 안 함 → s3는 원래 구간(30분)이라 이동 안내 유지
  assert.deepEqual(
    rows.map((r) => r.time),
    ['09:00', '12:00', '13:30'],
  );
  assert.deepEqual(
    rows.map((r) => r.moveLabel),
    [undefined, undefined, '버스 30분'],
  );
});

test('순서를 바꾸면 바뀐 구간의 이동 안내는 뺀다', () => {
  const rows = draftDayRows(dropRow(createDraft(ROUTE, 1), 0, 'i_s3', 'i_s1'), 0, [], '#000');
  assert.deepEqual(
    rows.map((r) => r.itemId),
    ['i_s3', 'i_s1', 'i_s2', 'i_f1'],
  );
  // s1 → s2 구간은 원래와 같아 안내가 남는다.
  assert.deepEqual(
    rows.map((r) => r.moveLabel),
    [undefined, undefined, '버스 20분', '버스 10분'],
  );
});

test('넣은 곳과 바꾼 식당: 넣은 곳은 장소 id로 시각을 찾고, 바꾼 식당은 원래 이름을 알려 준다', () => {
  const added = addSight(createDraft(ROUTE, 1), { placeId: 'plc_new', name: '새 곳', lat: 35.2, lng: 129.2, category: null }, 0);
  const swapped = swapMeal(added, 'i_f1', { placeId: 'plc_f2', name: '국밥집' });
  const rows = draftDayRows(swapped, 0, [], '#000', { plc_new: at(17) });
  const meal = rows.find((r) => r.itemId === 'i_f1')!;
  assert.equal(meal.title, '국밥집');
  assert.equal(meal.category, '점심 · f1 이름 대신');
  assert.equal(meal.moveLabel, undefined);
  const extra = rows.find((r) => r.itemId === 'add:plc_new')!;
  assert.equal(extra.timeKey, 'plc_new');
  assert.equal(extra.time, '17:00');
  assert.deepEqual([extra.lat, extra.lng], [35.2, 129.2]);
});
