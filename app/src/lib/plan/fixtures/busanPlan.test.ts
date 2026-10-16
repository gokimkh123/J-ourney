import test from 'node:test';
import assert from 'node:assert/strict';

import { busanPlan } from './busanPlan.ts';
import { busanEvents } from '../../meeting/fixtures/busan.ts';
import type { MeetingEvent } from '../../meeting/types.ts';
import { memberReasons, needsMapCheck, parsePlan, totalItems } from '../parse.ts';

function of<T extends MeetingEvent['type']>(type: T) {
  return busanEvents.filter((e): e is Extract<MeetingEvent, { type: T }> => e.type === type);
}

const items = busanPlan.days.flatMap((d) => d.items);
const MEMBERS = ['mem_01', 'mem_02', 'mem_03', 'mem_04'];

test('parsePlan 통과와 deepEqual', () => {
  assert.deepEqual(parsePlan({ plan: busanPlan }), busanPlan);
});

test('id는 busanEvents 최종 planId, 상태 confirmed', () => {
  const confirmed = of('plan.confirmed');
  const planId = confirmed[confirmed.length - 1]!.data.planId;
  assert.equal(planId, 'pln_04');
  assert.equal(busanPlan.id, planId);
  assert.equal(busanPlan.status, 'confirmed');
});

test('날짜, 항목 수, 헬퍼', () => {
  assert.deepEqual(busanPlan.days.map((d) => [d.day, d.date, d.items.length]), [[1, '2026-11-14', 3], [2, '2026-11-15', 3]]);
  assert.equal(totalItems(busanPlan), 6);
  assert.deepEqual(items.filter(needsMapCheck).map((i) => i.id), ['itm_05', 'itm_07']);
  assert.deepEqual(memberReasons(items[0]!, 'mem_01'), ['든든하게 시작하는 첫 일정으로 시간표에 딱 맞아요.']);
  assert.deepEqual(memberReasons(items[0]!, 'mem_04'), []);
});

test('비용 합계와 예산', () => {
  const sum = items.reduce((s, i) => s + i.costPerPerson, 0);
  assert.equal(sum, 105000);
  assert.equal(busanPlan.costPerPerson, sum);
  assert.ok(sum < busanPlan.budgetPerPerson);
});

test('moveFromPrev: 하루 첫 항목만 null', () => {
  for (const day of busanPlan.days) {
    day.items.forEach((item, i) => {
      if (i === 0) assert.equal(item.moveFromPrev, null);
      else {
        assert.notEqual(item.moveFromPrev, null);
        assert.deepEqual(Object.keys(item.moveFromPrev!).sort(), ['distanceM', 'fareWon', 'minutes', 'mode', 'routeUrl', 'source']);
      }
    });
  }
});

test('forMembers·reasons 규칙', () => {
  for (const item of items) {
    assert.ok(item.forMembers.length >= 1);
    assert.ok(item.forMembers.every((m) => MEMBERS.includes(m)));
    assert.ok(item.reasons.length >= 1);
    for (const r of item.reasons) {
      assert.ok(item.forMembers.includes(r.memberId));
      assert.ok(r.text.trim().length > 0);
    }
  }
});

test('verified:false 장소는 검색 링크', () => {
  const unverified = items.filter((i) => i.place.verified === false);
  assert.ok(unverified.length >= 1);
  for (const i of unverified) {
    assert.ok(i.place.links.kakaoMap.includes('/search/'));
    assert.equal(i.place.kakaoPlaceId, null);
  }
});

test('votes·satisfaction·concessions', () => {
  assert.deepEqual(busanPlan.votes.map((v) => [v.memberId, v.decision]), MEMBERS.map((m) => [m, 'approve']));
  const agreed = of('meeting.agreed');
  const last = agreed[agreed.length - 1]!.data;
  assert.equal(last.planId, busanPlan.id);
  assert.deepEqual(busanPlan.satisfaction, last.satisfaction);
  assert.deepEqual(busanPlan.satisfaction.map((s) => s.score), [8, 9, 8, 9]);
  assert.ok(busanPlan.concessions.length >= 1);
});

test('pln_04 route와 itemId·이름·좌표 일치', () => {
  const proposals = of('plan.proposed').filter((e) => e.data.planId === busanPlan.id);
  const route = proposals[proposals.length - 1]!.data.route;
  assert.equal(route.length, busanPlan.days.length);
  route.forEach((routeDay, d) => {
    const day = busanPlan.days[d]!;
    assert.equal(routeDay.day, day.day);
    assert.deepEqual(
      day.items.map((i) => [i.id, i.place.name, i.place.lat, i.place.lng]),
      routeDay.stops.map((s) => [s.itemId, s.name, s.lat, s.lng]),
    );
  });
  assert.deepEqual(route.flatMap((d) => d.stops.map((s) => s.itemId)), ['itm_01', 'itm_04', 'itm_02', 'itm_05', 'itm_07', 'itm_03']);
});
