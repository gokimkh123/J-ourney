import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import { ApiError } from './errors.ts';
import type { PlanEdit } from '../plan/planEdit.ts';

// 명세 v2.3 일정 표 API 7개: 주소·방식·본문, 응답은 읽지 않고 그대로 돌려준다.

type Call = { url: string; method: string; body: unknown };

function setup(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, getToken: () => 'tok' });
  return { endpoints: createEndpoints(client), calls };
}

const board = { status: 'choosing', meetingId: 'mtg_1', candidates: [], choice: {}, edits: [] };

test('getPlan·getPlanOptions: GET, 응답을 그대로 돌려준다', async () => {
  const { endpoints, calls } = setup(200, board);
  assert.deepEqual(await endpoints.getPlan('trp 1'), board);
  await endpoints.getPlanOptions('trp_1');
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ['GET', 'http://host/api/v1/trips/trp%201/plan'],
      ['GET', 'http://host/api/v1/trips/trp_1/plan/options'],
    ],
  );
});

test('choosePlan·votePlan: memberId는 줄 때만 본문에 넣는다', async () => {
  const { endpoints, calls } = setup(200, board);
  await endpoints.choosePlan('trp_1', 'pln_A');
  await endpoints.choosePlan('trp_1', 'pln_B', 'mem_02');
  await endpoints.votePlan('trp_1', 'approve');
  await endpoints.votePlan('trp_1', 'reject', 'mem_03');
  assert.deepEqual(calls, [
    { url: 'http://host/api/v1/trips/trp_1/plan/choice', method: 'POST', body: { planId: 'pln_A' } },
    { url: 'http://host/api/v1/trips/trp_1/plan/choice', method: 'POST', body: { planId: 'pln_B', memberId: 'mem_02' } },
    { url: 'http://host/api/v1/trips/trp_1/plan/votes', method: 'POST', body: { decision: 'approve' } },
    { url: 'http://host/api/v1/trips/trp_1/plan/votes', method: 'POST', body: { decision: 'reject', memberId: 'mem_03' } },
  ]);
});

test('closeChoice·requestConfirm·editPlan: POST 주소와 본문', async () => {
  const { endpoints, calls } = setup(200, board);
  await endpoints.closeChoice('trp_1');
  await endpoints.requestConfirm('trp_1');
  const edits: PlanEdit[] = [
    { type: 'remove', itemId: 'A-0-plc_1' },
    { type: 'reorder', day: 0, itemIds: ['A-0-plc_2', 'A-0-plc_3'] },
    { type: 'meal', itemId: 'A-0-plc_7', placeId: null },
  ];
  await endpoints.editPlan('trp_1', edits);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ['POST', 'http://host/api/v1/trips/trp_1/plan/choice/close'],
      ['POST', 'http://host/api/v1/trips/trp_1/plan/confirm'],
      ['POST', 'http://host/api/v1/trips/trp_1/plan/edits'],
    ],
  );
  assert.deepEqual(calls[2].body, { edits });
});

test('서버 오류는 ApiError 코드로 던진다(PLAN_LOCKED)', async () => {
  const { endpoints } = setup(409, { error: { code: 'PLAN_LOCKED', message: '다른 사람이 먼저 고쳤음' } });
  await assert.rejects(endpoints.editPlan('trp_1', [{ type: 'remove', itemId: 'x' }]), (e: unknown) => e instanceof ApiError && e.code === 'PLAN_LOCKED');
});
