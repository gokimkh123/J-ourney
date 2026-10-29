import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api/errors.ts';
import { parseEditOptions, parseEditResults, parsePlanBoard } from './board.ts';

function stop(extra: Record<string, unknown> = {}) {
  return {
    itemId: 'A-0-plc_1',
    placeId: 'plc_1',
    name: '감천문화마을',
    lat: 35.09,
    lng: 129.01,
    kind: 'sight',
    category: 'A0101',
    meal: null,
    night: false,
    mustFor: [],
    likedBy: ['mem_1'],
    moveFromPrev: null,
    ...extra,
  };
}

function plan(extra: Record<string, unknown> = {}) {
  return {
    planId: 'pln_A',
    version: 2,
    label: 'A',
    moveMode: 'transit',
    lodging: { placeId: 'plc_9', name: '호텔' },
    route: [
      {
        day: 1,
        date: '2026-11-04',
        stops: [stop()],
        summary: { moveMinutes: 30, unknownLegs: 0, spanMinutes: 480, heavy: false },
      },
    ],
    notes: [],
    changes: ['1일째 광안리 뺌 → 해운대'],
    ...extra,
  };
}

function candidate(extra: Record<string, unknown> = {}) {
  return {
    planId: 'pln_A',
    label: 'A',
    version: 2,
    title: '바다 따라',
    summary: '해안 위주',
    source: 'llm',
    satisfaction: {
      average: 7.5,
      passed: true,
      members: [{ memberId: 'mem_1', agentId: 'agt_1', score: 8, stance: 'support' }],
    },
    concessions: [{ memberId: 'mem_1', mustMissed: ['아침 늦게 시작'], warned: ['케이블카'] }],
    plan: plan(),
    ...extra,
  };
}

function board(extra: Record<string, unknown> = {}) {
  return {
    status: 'revising',
    meetingId: 'mtg_1',
    candidates: [candidate()],
    choice: {
      votes: [{ memberId: 'mem_1', planId: 'pln_A' }],
      answered: 1,
      total: 2,
      chosen: { planId: 'pln_A', label: 'A', by: 'host', tie: true, votes: { A: 1, B: 1 } },
    },
    plan: plan(),
    edits: [{ version: 2, by: 'mem_1', at: '2026-11-04T10:00:00+09:00', changes: ['…'] }],
    confirm: null,
    confirmedAt: null,
    ...extra,
  };
}

function isBadResponse(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 0 &&
    e.code === 'BAD_RESPONSE' &&
    e.message === '서버 응답을 읽을 수 없어요'
  );
}

test('예시 응답이 모든 칸 그대로 읽히고 남는 칸은 없다', () => {
  const { source: _source, ...cand } = candidate();
  assert.deepEqual(parsePlanBoard(board()), { ...board(), candidates: [cand] });
});

test('최상위 모양이 틀리면 BAD_RESPONSE', () => {
  const bad: unknown[] = [
    [],
    null,
    'x',
    board({ status: 'done' }),
    board({ candidates: {} }),
    board({ edits: {} }),
    board({ meetingId: 1 }),
    board({ choice: undefined }),
    board({ choice: [] }),
  ];
  for (const b of bad) assert.throws(() => parsePlanBoard(b), isBadResponse);
});

test('틀린 항목은 버려지고 나머지는 남는다', () => {
  const { title: _t, summary: _s, ...noText } = candidate({ planId: 'pln_B', label: 'B' });
  const parsed = parsePlanBoard(
    board({
      candidates: [
        candidate({ planId: 1 }),
        candidate({ label: 'C' }),
        candidate({ plan: { planId: 'x' } }),
        noText,
        'junk',
      ],
      choice: {
        votes: [{ memberId: 'm', planId: 'p' }, { memberId: 1, planId: 'p' }, { memberId: 'm' }],
        answered: 'x',
        total: 2,
        chosen: null,
      },
      edits: [
        { version: 3, by: 'm', changes: ['a', 1] },
        { version: 'x', by: 'm' },
        { version: 4 },
      ],
      plan: plan({
        route: [
          { day: 1, stops: [stop({ lat: 'x' }), stop({ itemId: 'ok', moveFromPrev: undefined, category: 5 }), 3] },
          { day: 'x', stops: [] },
          { day: 2 },
        ],
      }),
    }),
  );
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].planId, 'pln_B');
  assert.equal(parsed.candidates[0].title, 'B안');
  assert.equal(parsed.candidates[0].summary, '');
  assert.deepEqual(parsed.choice.votes, [{ memberId: 'm', planId: 'p' }]);
  assert.equal(parsed.choice.answered, 0);
  assert.deepEqual(parsed.edits, [{ version: 3, by: 'm', at: '', changes: ['a'] }]);
  assert.deepEqual(parsed.plan?.route, [
    {
      day: 1,
      stops: [{ itemId: 'ok', name: '감천문화마을', lat: 35.09, lng: 129.01, kind: 'sight', meal: null, night: false, mustFor: [], likedBy: ['mem_1'], placeId: 'plc_1' }],
    },
  ]);
});

test('후보의 version·satisfaction·concessions 기본값과 버림', () => {
  const parsed = parsePlanBoard(
    board({
      candidates: [
        candidate({
          version: 'x',
          satisfaction: 'bad',
          concessions: [{ memberId: 'm', mustMissed: ['a', 2], warned: 'x' }, { mustMissed: [] }],
        }),
      ],
    }),
  );
  const c = parsed.candidates[0];
  assert.equal(c.version, 1);
  assert.deepEqual(c.satisfaction, { average: 0, passed: false, members: [] });
  assert.deepEqual(c.concessions, [{ memberId: 'm', mustMissed: ['a'], warned: [] }]);
});

test('ProposedPlan 기본값', () => {
  const parsed = parsePlanBoard(
    board({ plan: plan({ version: 'x', moveMode: 'bike', lodging: { placeId: 1, name: 'h' }, notes: ['n', 1], changes: 'x' }) }),
  );
  assert.equal(parsed.plan?.version, 1);
  assert.equal(parsed.plan?.moveMode, 'transit');
  assert.equal(parsed.plan?.lodging, null);
  assert.deepEqual(parsed.plan?.notes, ['n']);
  assert.deepEqual(parsed.plan?.changes, []);
  assert.equal(parsePlanBoard(board({ plan: plan({ moveMode: 'car' }) })).plan?.moveMode, 'car');
});

test('route 선택 칸·summary·date는 모양이 맞을 때만 붙는다', () => {
  const parsed = parsePlanBoard(
    board({
      plan: plan({
        route: [
          {
            day: 1,
            date: 5,
            summary: { moveMinutes: 1, unknownLegs: 0, spanMinutes: 2, heavy: 'no' },
            stops: [
              {
                itemId: 'i',
                name: 'n',
                lat: 1,
                lng: 2,
                placeId: 3,
                kind: 'zoo',
                category: 4,
                meal: 'brunch',
                night: 'yes',
                mustFor: 'x',
                likedBy: ['a', 1],
              },
            ],
          },
        ],
      }),
    }),
  );
  const day = parsed.plan?.route[0];
  assert.ok(day);
  assert.equal('date' in day, false);
  assert.equal('summary' in day, false);
  assert.deepEqual(day.stops, [{ itemId: 'i', name: 'n', lat: 1, lng: 2, likedBy: ['a'] }]);
});

test('moveFromPrev: 알 수 없는 mode는 null, source는 estimate, distanceM 없으면 0', () => {
  const read = (leg: unknown) =>
    parsePlanBoard(board({ plan: plan({ route: [{ day: 1, stops: [stop({ moveFromPrev: leg })] }] }) })).plan?.route[0].stops[0]
      .moveFromPrev;
  assert.deepEqual(read({ mode: 'rocket', minutes: 'x', source: 'magic', routeUrl: 3 }), {
    mode: null,
    minutes: null,
    distanceM: 0,
    fareWon: null,
    source: 'estimate',
    routeUrl: null,
  });
  assert.deepEqual(
    read({ mode: 'bus', minutes: 12, distanceM: 900, fareWon: 1500, source: 'kakao_route', routeUrl: 'u', note: 'n' }),
    { mode: 'bus', minutes: 12, distanceM: 900, fareWon: 1500, source: 'kakao_route', routeUrl: 'u', note: 'n' },
  );
  assert.equal(read('x'), null);
});

test('plan·confirm·chosen이 null이거나 틀리면 null, confirm 정상 케이스', () => {
  const bad = parsePlanBoard(
    board({
      plan: null,
      confirm: 'x',
      choice: { votes: [], answered: 0, total: 0, chosen: { planId: 'p', label: 'Z' } },
      confirmedAt: 5,
    }),
  );
  assert.equal(bad.plan, null);
  assert.equal(bad.confirm, null);
  assert.equal(bad.choice.chosen, null);
  assert.equal(bad.confirmedAt, null);
  assert.equal(parsePlanBoard(board({ plan: { planId: 'p', label: 'A' } })).plan, null);

  const ok = parsePlanBoard(
    board({
      status: 'confirmed',
      confirm: {
        version: 2,
        votes: [
          { memberId: 'a', decision: 'approve' },
          { memberId: 'b', decision: 'revise' },
          { memberId: 'c', decision: 'reject' },
          { decision: 'approve' },
        ],
        answered: 2,
        total: 'x',
      },
      choice: { votes: [], answered: 0, total: 0, chosen: { planId: 'p', label: 'B', by: 'x', tie: 'y', votes: { A: 'z', B: 2 } } },
      confirmedAt: '2026-11-04T11:00:00+09:00',
    }),
  );
  assert.deepEqual(ok.confirm, {
    version: 2,
    votes: [
      { memberId: 'a', decision: 'approve' },
      { memberId: 'c', decision: 'reject' },
    ],
    answered: 2,
    total: 0,
  });
  assert.deepEqual(ok.choice.chosen, { planId: 'p', label: 'B', by: 'all', tie: false, votes: { A: 0, B: 2 } });
  assert.equal(ok.confirmedAt, '2026-11-04T11:00:00+09:00');
});

test('parseEditResults', () => {
  assert.deepEqual(parseEditResults(null), []);
  assert.deepEqual(parseEditResults([]), []);
  assert.deepEqual(parseEditResults({ results: {} }), []);
  assert.deepEqual(
    parseEditResults({
      results: [{ applied: true, note: 'ok' }, { applied: 'x', note: 'n' }, { applied: false }, 3, { applied: false, note: 'no' }],
    }),
    [
      { applied: true, note: 'ok' },
      { applied: false, note: 'no' },
    ],
  );
});

test('parseEditOptions', () => {
  for (const bad of [null, [], 'x']) assert.throws(() => parseEditOptions(bad), isBadResponse);
  assert.deepEqual(parseEditOptions({ sights: 'x', meals: [] }), { sights: [], meals: {} });

  const parsed = parseEditOptions({
    sights: [
      { placeId: 'p', name: 'n', lat: 1, lng: 2, category: 3, likedBy: ['a', 1], mustFor: 'x', closedDays: [1, 'x', 2] },
      { placeId: 'q', name: 'n', lat: 'x', lng: 2 },
      { name: 'n', lat: 1, lng: 2 },
    ],
    meals: {
      'A-0-plc_1': [{ placeId: 'r', name: 'm', category: 'F', detourKm: 1.5 }, { placeId: 'r' }, { placeId: 's', name: 't' }],
      bad: 'x',
    },
  });
  assert.deepEqual(parsed.sights, [
    { placeId: 'p', name: 'n', category: null, lat: 1, lng: 2, likedBy: ['a'], mustFor: [], closedDays: [1, 2] },
  ]);
  assert.deepEqual(parsed.meals, {
    'A-0-plc_1': [
      { placeId: 'r', name: 'm', category: 'F', detourKm: 1.5 },
      { placeId: 's', name: 't', category: null, detourKm: 0 },
    ],
  });
});
