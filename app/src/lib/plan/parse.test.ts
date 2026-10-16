import test from 'node:test';
import assert from 'node:assert/strict';

import { memberReasons, needsMapCheck, parsePlan, totalItems } from './parse.ts';

type J = Record<string, any>;

function place(id: string, verified = true): J {
  return {
    id,
    name: `장소${id}`,
    address: '부산',
    lat: 35.1,
    lng: 129.0,
    openHours: '09:00-21:00',
    menu: '국밥',
    popularity: 80,
    crowd: 50,
    priceLevel: 1,
    kakaoPlaceId: '123',
    verified,
    links: { kakaoMap: 'https://k', naverMap: 'https://n' },
    sources: ['tour'],
    baseDate: '2026-10-01',
    checkedAt: '2026-10-10T09:00:00+09:00',
  };
}

function item(id: string, verified = true): J {
  return {
    id,
    startTime: '10:00',
    title: `제목${id}`,
    category: 'food',
    costPerPerson: 10000,
    moveFromPrev: { mode: 'walk', minutes: 10, distanceM: 700, fareWon: 0, source: 'kakao', routeUrl: 'https://r' },
    place: place(`p${id}`, verified),
    forMembers: ['mem_01', 'mem_02'],
    reasons: [
      { memberId: 'mem_01', text: '이유1' },
      { memberId: 'mem_02', text: '이유2' },
      { memberId: 'mem_01', text: '이유3' },
    ],
  };
}

function raw(): J {
  return {
    plan: {
      id: 'pln_04',
      version: 4,
      status: 'confirmed',
      costPerPerson: 20000,
      budgetPerPerson: 250000,
      maxStepsPerDay: 4,
      satisfaction: [{ memberId: 'mem_01', score: 8 }],
      concessions: [{ memberId: 'mem_01', gave: 'a', got: 'b' }],
      votes: [{ memberId: 'mem_01', decision: 'approve' }],
      days: [
        { day: 1, date: '2026-11-14', items: [{ ...item('1'), moveFromPrev: null }, item('2', false)] },
        { day: 2, date: '2026-11-15', items: [item('3')] },
      ],
    },
  };
}

function errorOf(mutate: (j: J) => void): Error {
  const j = raw();
  mutate(j);
  try {
    parsePlan(j);
  } catch (e) {
    return e as Error;
  }
  return assert.fail('오류가 발생해야 합니다.');
}

test('정상 파싱 값', () => {
  const plan = parsePlan(raw());
  assert.equal(plan.id, 'pln_04');
  assert.equal(plan.version, 4);
  assert.equal(plan.status, 'confirmed');
  assert.equal(plan.costPerPerson, 20000);
  assert.equal(plan.budgetPerPerson, 250000);
  assert.equal(plan.maxStepsPerDay, 4);
  assert.deepEqual(plan.satisfaction, [{ memberId: 'mem_01', score: 8 }]);
  assert.deepEqual(plan.concessions, [{ memberId: 'mem_01', gave: 'a', got: 'b' }]);
  assert.deepEqual(plan.votes, [{ memberId: 'mem_01', decision: 'approve' }]);
  assert.deepEqual(plan.days.map((d) => [d.day, d.date, d.items.length]), [[1, '2026-11-14', 2], [2, '2026-11-15', 1]]);
  const first = plan.days[0]!.items[0]!;
  assert.equal(first.startTime, '10:00');
  assert.equal(first.category, 'food');
  assert.equal(first.place.name, '장소p1');
  assert.equal(first.place.lat, 35.1);
  assert.deepEqual(first.place.links, { kakaoMap: 'https://k', naverMap: 'https://n' });
  assert.deepEqual(first.place.sources, ['tour']);
  assert.deepEqual(first.forMembers, ['mem_01', 'mem_02']);
  const move = plan.days[0]!.items[1]!.moveFromPrev;
  assert.deepEqual(move, { mode: 'walk', minutes: 10, distanceM: 700, fareWon: 0, source: 'kakao', routeUrl: 'https://r' });
});

test('필드 누락은 한국어 오류', () => {
  assert.match(errorOf((j) => delete j.plan.id).message, /id 값이 문자열이 아닙니다/);
  assert.match(errorOf((j) => delete j.plan.days[0].items[0].place.address).message, /address/);
  assert.match(errorOf((j) => delete j.plan.votes).message, /votes 값이 배열이 아닙니다/);
  assert.match(errorOf((j) => delete j.plan.days[0].items[1].moveFromPrev).message, /이동 정보/);
  assert.match(errorOf((j) => delete j.plan.days[0].items[0].place.links.naverMap).message, /naverMap/);
});

test('plan 키 없음·객체가 아닌 입력', () => {
  assert.throws(() => parsePlan({}), /plan이 없습니다/);
  assert.throws(() => parsePlan(null), /객체 형식이 아닙니다/);
  assert.throws(() => parsePlan('x'), /객체 형식이 아닙니다/);
  assert.throws(() => parsePlan([]), /객체 형식이 아닙니다/);
  assert.throws(() => parsePlan({ plan: 3 }), /객체 형식이 아닙니다/);
});

test('허용되지 않는 status·decision', () => {
  assert.match(errorOf((j) => (j.plan.status = 'done')).message, /status 값이 올바르지 않습니다: done/);
  assert.match(errorOf((j) => (j.plan.votes[0].decision = 'yes')).message, /decision 값이 올바르지 않습니다: yes/);
  for (const s of ['voting', 'revising', 'confirmed']) {
    const j = raw();
    j.plan.status = s;
    assert.equal(parsePlan(j).status, s);
  }
  for (const d of ['approve', 'revise', 'reject', 'pending']) {
    const j = raw();
    j.plan.votes[0].decision = d;
    assert.equal(parsePlan(j).votes[0]!.decision, d);
  }
});

test('타입 불일치', () => {
  assert.match(errorOf((j) => (j.plan.costPerPerson = '20000')).message, /costPerPerson 값이 숫자가 아닙니다/);
  assert.match(errorOf((j) => (j.plan.days[0].items[0].place.verified = 'true')).message, /verified 값이 true\/false가 아닙니다/);
  assert.match(errorOf((j) => (j.plan.days = {})).message, /days 값이 배열이 아닙니다/);
  assert.match(errorOf((j) => (j.plan.days[0].items[0].place.lat = Number.NaN)).message, /lat 값이 숫자가 아닙니다/);
  assert.match(errorOf((j) => (j.plan.days[0].items[0].place.openHours = 5)).message, /openHours/);
  assert.match(errorOf((j) => (j.plan.days[0].items[0].forMembers = [1])).message, /forMembers/);
});

test('null 허용 필드', () => {
  const j = raw();
  const p = j.plan.days[0].items[1].place;
  p.openHours = null;
  p.menu = null;
  p.kakaoPlaceId = null;
  const plan = parsePlan(j);
  const parsed = plan.days[0]!.items[1]!;
  assert.equal(parsed.place.openHours, null);
  assert.equal(parsed.place.menu, null);
  assert.equal(parsed.place.kakaoPlaceId, null);
  assert.equal(plan.days[0]!.items[0]!.moveFromPrev, null);
});

test('서버가 보낸 추가 필드는 결과에 없다', () => {
  const j = raw();
  j.plan.extra = 1;
  j.plan.days[0].extra = 2;
  j.plan.days[0].items[0].extra = 3;
  j.plan.days[0].items[0].place.extra = 4;
  j.plan.days[0].items[0].place.links.extra = 5;
  j.plan.days[0].items[1].moveFromPrev.extra = 6;
  j.plan.votes[0].extra = 7;
  j.extraRoot = 8;
  const plan = parsePlan(j);
  assert.deepEqual(plan, parsePlan(raw()));
  assert.ok(!('extra' in plan));
  assert.ok(!('extra' in plan.days[0]!.items[0]!.place.links));
});

test('totalItems', () => {
  assert.equal(totalItems(parsePlan(raw())), 3);
  const j = raw();
  j.plan.days = [];
  assert.equal(totalItems(parsePlan(j)), 0);
});

test('memberReasons', () => {
  const it = parsePlan(raw()).days[0]!.items[0]!;
  assert.deepEqual(memberReasons(it, 'mem_01'), ['이유1', '이유3']);
  assert.deepEqual(memberReasons(it, 'mem_02'), ['이유2']);
  assert.deepEqual(memberReasons(it, 'mem_99'), []);
});

test('needsMapCheck', () => {
  const plan = parsePlan(raw());
  assert.equal(needsMapCheck(plan.days[0]!.items[0]!), false);
  assert.equal(needsMapCheck(plan.days[0]!.items[1]!), true);
});
