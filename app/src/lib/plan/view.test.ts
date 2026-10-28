import test from 'node:test';
import assert from 'node:assert/strict';

import { busanPlan } from './fixtures/busanPlan.ts';
import { needsMapCheck } from './parse.ts';
import type { Plan } from './types.ts';
import { dayTabs, findItem, placeDetail, planSummary, scheduleRows, voteRows } from './view.ts';

const members = [
  { memberId: 'mem_01', name: '민수', color: '#F97316' },
  { memberId: 'mem_02', name: '지은', color: '#EC4899' },
  { memberId: 'mem_03', name: '현우', color: '#0EA5E9' },
  { memberId: 'mem_04', name: '서연', color: '#10B981' },
];

function copy(): Plan {
  return structuredClone(busanPlan);
}

test('dayTabs: 개수·키·라벨', () => {
  assert.deepEqual(dayTabs(busanPlan), [
    { key: 'day-1', label: '1일차' },
    { key: 'day-2', label: '2일차' },
  ]);
});

test('scheduleRows: 항목 수, verified, moveLabel', () => {
  const expectedMoves = [
    [undefined, '도보 8분', '버스 15분 · 1,550원', '버스 20분 · 1,550원', '버스 30분 · 1,550원', '지하철 65분 · 1,750원'],
    [undefined, '버스 20분 · 1,550원', '버스 35분 · 1,750원', '택시 10분 · 6,500원'],
  ];
  busanPlan.days.forEach((day, d) => {
    const rows = scheduleRows(busanPlan, day.day, members);
    assert.equal(rows.length, day.items.length);
    rows.forEach((row, i) => {
      const item = day.items[i]!;
      assert.equal(row.itemId, item.id);
      assert.equal(row.time, item.startTime);
      assert.equal(row.verified, !needsMapCheck(item));
      if (i === 0) assert.equal('moveLabel' in row, false);
      else assert.equal(row.moveLabel, expectedMoves[d]![i]);
    });
  });
  const first = scheduleRows(busanPlan, 1, members)[0]!;
  assert.equal(first.category, '식사');
  assert.deepEqual(first.forMembers, [
    { name: '민수', color: '#F97316' },
    { name: '현우', color: '#0EA5E9' },
  ]);
});

test('costLabel: 무료와 금액', () => {
  assert.equal(scheduleRows(busanPlan, 1, members)[0]!.costLabel, '9,000원');
  const free = copy();
  free.days[0]!.items[0]!.costPerPerson = 0;
  assert.equal(scheduleRows(free, 1, members)[0]!.costLabel, '무료');
  assert.equal(placeDetail(free, 'itm_01', members)!.costLabel, '무료');
  assert.equal(placeDetail(busanPlan, 'itm_01', members)!.costLabel, '9,000원');
});

test('없는 day·itemId', () => {
  assert.deepEqual(scheduleRows(busanPlan, 9, members), []);
  assert.equal(findItem(busanPlan, 'nope'), undefined);
  assert.equal(findItem(busanPlan, 'itm_03')?.id, 'itm_03');
  assert.equal(placeDetail(busanPlan, 'nope', members), null);
});

test('placeDetail: rows 순서, 메뉴 생략, 정보 없음, reasons', () => {
  const detail = placeDetail(busanPlan, 'itm_01', members)!;
  assert.deepEqual(detail.rows.map((r) => r.label), ['주소', '영업시간', '메뉴', '인기도', '혼잡도']);
  assert.deepEqual(detail.rows[0], { label: '주소', value: '부산 중구 신창동4가' });
  assert.deepEqual(detail.rows[3], { label: '인기도', value: '82/100' });
  assert.deepEqual(detail.rows[4], { label: '혼잡도', value: '보통' });
  assert.deepEqual(detail.reasons.map((r) => [r.name, r.color]), [
    ['민수', '#F97316'],
    ['현우', '#0EA5E9'],
  ]);
  assert.equal(detail.kakaoMapUrl, busanPlan.days[0]!.items[0]!.place.links.kakaoMap);
  assert.equal(detail.naverMapUrl, busanPlan.days[0]!.items[0]!.place.links.naverMap);

  const noMenu = placeDetail(busanPlan, 'itm_04', members)!;
  assert.deepEqual(noMenu.rows.map((r) => r.label), ['주소', '영업시간', '인기도', '혼잡도']);
  assert.equal(noMenu.rows[1]!.value, '정보 없음');
});

test('planSummary: 합계와 overBudget', () => {
  assert.deepEqual(planSummary(busanPlan), {
    costLabel: '150,000원',
    budgetLabel: '예산 250,000원',
    overBudget: false,
    itemCount: 10,
    dayCount: 2,
  });
  const low = copy();
  low.budgetPerPerson = 100000;
  assert.equal(planSummary(low).overBudget, true);
});

test('voteRows: label 매핑', () => {
  const plan = copy();
  plan.votes = [
    { memberId: 'mem_01', decision: 'approve' },
    { memberId: 'mem_02', decision: 'revise' },
    { memberId: 'mem_03', decision: 'reject' },
    { memberId: 'mem_04', decision: 'pending' },
  ];
  assert.deepEqual(voteRows(plan, members).map((r) => [r.name, r.decision, r.label]), [
    ['민수', 'approve', '찬성'],
    ['지은', 'revise', '수정 요청'],
    ['현우', 'reject', '반대'],
    ['서연', 'pending', '대기 중'],
  ]);
  assert.equal(voteRows(plan, members)[0]!.color, '#F97316');
});

test('members에 없는 memberId는 건너뜀', () => {
  const few = members.filter((m) => m.memberId !== 'mem_03');
  assert.deepEqual(scheduleRows(busanPlan, 1, few)[0]!.forMembers, [{ name: '민수', color: '#F97316' }]);
  assert.deepEqual(placeDetail(busanPlan, 'itm_01', few)!.reasons.map((r) => r.name), ['민수']);
  assert.deepEqual(voteRows(busanPlan, few).map((r) => r.name), ['민수', '지은', '서연']);
  assert.deepEqual(voteRows(busanPlan, []), []);
});

test('입력을 바꾸지 않음', () => {
  const planBefore = JSON.stringify(busanPlan);
  const membersBefore = JSON.stringify(members);
  dayTabs(busanPlan);
  scheduleRows(busanPlan, 1, members);
  scheduleRows(busanPlan, 2, members);
  findItem(busanPlan, 'itm_01');
  placeDetail(busanPlan, 'itm_04', members);
  planSummary(busanPlan);
  voteRows(busanPlan, members);
  assert.equal(JSON.stringify(busanPlan), planBefore);
  assert.equal(JSON.stringify(members), membersBefore);
});
