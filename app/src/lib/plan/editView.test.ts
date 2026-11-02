import test from 'node:test';
import assert from 'node:assert/strict';

import type { RouteDay } from '../meeting/types.ts';
import type { EditOptions, PlanBoard } from './board.ts';
import { addableSights, canEdit, dayIndexOf, failedNotes, historyRows, mealChoices, reorderEdit, stopActions, whenLabel } from './editView.ts';

const stop = (itemId: string, kind: 'sight' | 'food' | 'lodging', meal: 'lunch' | 'dinner' | null = null) => ({ itemId, name: itemId, lat: 35, lng: 129, kind, meal });

const route: RouteDay[] = [
  { day: 1, stops: [stop('s1', 'sight'), stop('s2', 'sight'), stop('f1', 'food', 'lunch'), stop('s3', 'sight'), stop('h1', 'lodging')] },
  { day: 2, stops: [stop('s4', 'sight'), stop('f2', 'food', 'dinner')] },
  { day: 3, stops: [stop('s5', 'sight')] },
];

const members = [
  { memberId: 'mem_1', name: '민수', color: '#111111' },
  { memberId: 'mem_2', name: '지은', color: '#222222' },
];

function board(status: PlanBoard['status'], edits: PlanBoard['edits'] = []): PlanBoard {
  return {
    status,
    meetingId: 'mtg_1',
    candidates: [],
    choice: { votes: [], answered: 0, total: 2, chosen: null },
    plan: { planId: 'pln_A', version: 3, label: 'A', moveMode: 'transit', lodging: null, route, notes: [], changes: [] },
    edits,
    confirm: null,
    confirmedAt: null,
  };
}

test('canEdit: 고른 안을 고치는 중(revising)이고 안이 있을 때만', () => {
  assert.equal(canEdit(board('revising')), true);
  assert.equal(canEdit(board('choosing')), false);
  assert.equal(canEdit(board('voting')), false);
  assert.equal(canEdit({ ...board('revising'), plan: null }), false);
  assert.equal(canEdit(null), false);
});

test('dayIndexOf: 날짜 번호 → route 순번', () => {
  assert.equal(dayIndexOf(route, 2), 1);
  assert.equal(dayIndexOf(route, 9), -1);
});

test('stopActions: 관광지는 위·아래(관광지끼리)·다른 날, 식당은 끼니, 숙소는 없음', () => {
  assert.deepEqual(stopActions(route, 's1'), {
    kind: 'sight',
    dayIndex: 0,
    canUp: false,
    canDown: true,
    otherDays: [
      { index: 1, label: '2일차' },
      { index: 2, label: '3일차' },
    ],
  });
  const last = stopActions(route, 's3');
  assert.equal(last.kind === 'sight' && last.canUp && !last.canDown, true);
  assert.deepEqual(stopActions(route, 'f2'), { kind: 'meal', dayIndex: 1, mealLabel: '저녁' });
  assert.deepEqual(stopActions(route, 'h1'), { kind: 'none' });
  assert.deepEqual(stopActions(route, 'zz'), { kind: 'none' });
});

test('stopActions: 그날 관광지가 하나뿐이면 위·아래 모두 막힘', () => {
  const one = stopActions(route, 's5');
  assert.equal(one.kind === 'sight' && !one.canUp && !one.canDown, true);
});

test('reorderEdit: 식당·숙소를 건너 관광지끼리 바꾸고 그날 관광지 전부를 보낸다', () => {
  assert.deepEqual(reorderEdit(route, 's3', 'up'), { type: 'reorder', day: 0, itemIds: ['s1', 's3', 's2'] });
  assert.deepEqual(reorderEdit(route, 's1', 'down'), { type: 'reorder', day: 0, itemIds: ['s2', 's1', 's3'] });
  assert.equal(reorderEdit(route, 's1', 'up'), null);
  assert.equal(reorderEdit(route, 'f1', 'up'), null);
  // 원래 경로는 그대로
  assert.deepEqual(route[0]!.stops.map((s) => s.itemId), ['s1', 's2', 'f1', 's3', 'h1']);
});

const options: EditOptions = {
  sights: [
    { placeId: 'plc_9', name: '해운대', category: 'A01', lat: 35, lng: 129, likedBy: ['mem_2'], mustFor: ['mem_1', 'mem_2'], closedDays: [] },
    { placeId: 'plc_8', name: '부산타워', category: null, lat: 35, lng: 129, likedBy: ['mem_x'], mustFor: [], closedDays: [0, 2] },
  ],
  meals: { f1: [{ placeId: 'plc_7', name: '돼지국밥', category: null, detourKm: 0.4 }] },
};

test('addableSights: 고른 사람 얼굴(중복 없이, 모르는 사람은 뺌)과 그날 쉬는지', () => {
  const day0 = addableSights(options, 0, members);
  assert.deepEqual(day0.map((s) => [s.name, s.likedBy.map((m) => m.name), s.closed]), [
    ['해운대', ['민수', '지은'], false],
    ['부산타워', [], true],
  ]);
  assert.equal(addableSights(options, 1, members)[1]!.closed, false);
});

test('mealChoices: 더 가는 거리 글, 보기가 없으면 빈 목록', () => {
  assert.deepEqual(mealChoices(options, 'f1'), [{ placeId: 'plc_7', name: '돼지국밥', detourLabel: '+0.4km' }]);
  assert.deepEqual(mealChoices(options, 'f2'), []);
});

test('failedNotes: 반영 못 한 건의 서버 문장만', () => {
  assert.deepEqual(
    failedNotes([
      { applied: true, note: '1일째 s1 뺌' },
      { applied: false, note: '반영 못 함: 그날 쉬는 곳' },
    ]),
    ['반영 못 함: 그날 쉬는 곳'],
  );
});

test('whenLabel: 서버 한국 시각 글자에서 바로 읽는다', () => {
  assert.equal(whenLabel('2026-11-04T09:05:00+09:00'), '11/4 09:05');
  assert.equal(whenLabel(''), '');
});

test('historyRows: 새 것부터, 이름으로, 바뀐 점 없는 기록은 뺌', () => {
  const rows = historyRows(
    board('revising', [
      { version: 2, by: 'mem_1', at: '2026-11-04T14:05:00+09:00', changes: ['1일째 관광지 순서 바꿈'] },
      { version: 3, by: 'mem_2', at: '2026-11-04T14:20:00+09:00', changes: ['2일째 광안리 뺌'] },
      { version: 4, by: 'mem_9', at: '2026-11-04T14:30:00+09:00', changes: [] },
      { version: 5, by: 'mem_9', at: '2026-11-04T14:40:00+09:00', changes: ['3일째 범어사 넣음'] },
    ]),
    members,
  );
  assert.deepEqual(rows, [
    { key: 'v5', who: '누군가', when: '11/4 14:40', changes: ['3일째 범어사 넣음'] },
    { key: 'v3', who: '지은', when: '11/4 14:20', changes: ['2일째 광안리 뺌'] },
    { key: 'v2', who: '민수', when: '11/4 14:05', changes: ['1일째 관광지 순서 바꿈'] },
  ]);
});
