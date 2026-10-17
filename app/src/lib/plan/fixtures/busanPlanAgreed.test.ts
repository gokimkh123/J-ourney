import assert from 'node:assert/strict';
import test from 'node:test';

import { busanEvents } from '../../meeting/fixtures/busan.ts';
import { eventsUntilFirstAgreed } from '../../meeting/player.ts';
import { applyEvent, initialMeetingState } from '../../meeting/reducer.ts';
import { parsePlan } from '../parse.ts';
import { busanPlanAgreed } from './busanPlanAgreed.ts';

// 회의 재생이 끝난 상태(첫 합의)
function agreedState() {
  let state = initialMeetingState();
  for (const event of eventsUntilFirstAgreed(busanEvents)) state = applyEvent(state, event).state;
  return state;
}

test('parsePlan을 통과한다', () => {
  assert.deepEqual(parsePlan({ plan: busanPlanAgreed }), busanPlanAgreed);
});

test('회의가 합의한 planId·장소 순서와 같다(합의안 화면과 일정 화면이 같은 안)', () => {
  const state = agreedState();
  assert.equal(state.agreement?.planId, busanPlanAgreed.id);
  const route = state.plans[busanPlanAgreed.id]!.route;
  assert.equal(route.length, busanPlanAgreed.days.length);
  route.forEach((routeDay, d) => {
    const day = busanPlanAgreed.days[d]!;
    assert.equal(routeDay.day, day.day);
    assert.deepEqual(
      day.items.map((i) => [i.id, i.place.name, i.place.lat, i.place.lng]),
      routeDay.stops.map((s) => [s.itemId, s.name, s.lat, s.lng]),
    );
  });
});

test('만족도·양보가 합의 이벤트와 같고, 사람 투표는 아직 대기 중', () => {
  const agreement = agreedState().agreement!;
  assert.deepEqual(busanPlanAgreed.satisfaction, agreement.satisfaction);
  assert.deepEqual(busanPlanAgreed.concessions, agreement.concessions);
  assert.equal(busanPlanAgreed.status, 'voting');
  assert.ok(busanPlanAgreed.votes.every((v) => v.decision === 'pending'));
});

test('하루 첫 항목만 이동 정보가 없고, 시간이 앞에서 뒤로 흐른다', () => {
  for (const day of busanPlanAgreed.days) {
    day.items.forEach((item, i) => assert.equal(item.moveFromPrev === null, i === 0));
    const times = day.items.map((i) => i.startTime);
    assert.deepEqual([...times].sort(), times);
  }
});

test('비용 합계가 일정 비용과 같다', () => {
  const sum = busanPlanAgreed.days.flatMap((d) => d.items).reduce((s, i) => s + i.costPerPerson, 0);
  assert.equal(busanPlanAgreed.costPerPerson, sum);
});
