import test from 'node:test';
import assert from 'node:assert/strict';

import type { MemberRef } from '../meeting/view.ts';
import type { RouteDay, RouteStop } from '../meeting/types.ts';
import { planShareSheet } from './planShare.ts';

const sight = (itemId: string, name: string): RouteStop => ({ itemId, name, lat: 35, lng: 129, placeId: `plc_${itemId}` }) as RouteStop;
const meal = (itemId: string, name: string, when: 'lunch' | 'dinner'): RouteStop =>
  ({ itemId, name, lat: 35, lng: 129, placeId: `plc_${itemId}`, kind: 'food', meal: when }) as RouteStop;
const member = (memberId: string): MemberRef => ({ memberId, name: memberId, color: '#000000' }) as MemberRef;

const ROUTE: RouteDay[] = [
  { day: 1, date: '2026-11-14', stops: [sight('s1', '국제시장'), meal('f1', '자갈치 식당', 'lunch')] },
  { day: 2, date: '2026-11-15', stops: [sight('s2', '해운대')] },
];

test('모든 날을 시각과 장소만 적고, 관광이 아닌 곳만 종류를 붙인다', () => {
  const sheet = planShareSheet('부산 1박 2일', ROUTE, [member('a'), member('b')]);
  assert.equal(sheet.title, '부산 1박 2일');
  assert.equal(sheet.meta, '11월 14일 (토) ~ 15일 (일) · 2명');
  assert.deepEqual(
    sheet.days.map((d) => [d.label, d.date]),
    [
      ['1일차', '11월 14일 (토)'],
      ['2일차', '11월 15일 (일)'],
    ],
  );
  assert.equal(sheet.days[0]!.lines[0]!.text, '국제시장');
  assert.equal(sheet.days[0]!.lines[1]!.text, '자갈치 식당 (점심)');
  assert.match(sheet.days[0]!.lines[0]!.time, /^\d\d:\d\d$/);
});

test('달이 바뀌면 끝 날짜에도 달을 적고, 날짜·인원을 모르면 뺀다', () => {
  const across: RouteDay[] = [
    { day: 1, date: '2026-11-30', stops: [sight('s1', 'A')] },
    { day: 2, date: '2026-12-01', stops: [sight('s2', 'B')] },
  ];
  assert.equal(planShareSheet('t', across, []).meta, '11월 30일 (월) ~ 12월 1일 (화)');
  assert.equal(planShareSheet('t', [{ day: 1, stops: [sight('s1', 'A')] }], []).meta, '');
  assert.equal(planShareSheet('t', [{ day: 1, stops: [sight('s1', 'A')] }], []).days[0]!.date, null);
});
