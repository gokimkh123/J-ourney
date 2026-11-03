import test from 'node:test';
import assert from 'node:assert/strict';

import type { MoveLeg, RouteDay } from '../meeting/types.ts';
import { dayRows } from './chosenPlan.ts';

const leg = (mode: MoveLeg['mode'], minutes: number, fareWon: number | null): MoveLeg => ({
  mode,
  minutes,
  distanceM: 1000,
  fareWon,
  source: 'kakao_route',
  routeUrl: null,
});

test('택시 요금은 서버가 1인 몫으로 주므로 "1인"을 붙이고, 대중교통·도보는 그대로', () => {
  const route: RouteDay[] = [
    {
      day: 1,
      stops: [
        { itemId: 'a', name: '카페 385', lat: 35, lng: 129 },
        { itemId: 'b', name: '영진돼지국밥', lat: 35, lng: 129, moveFromPrev: leg('taxi', 40, 4000) },
        { itemId: 'c', name: '문화공감', lat: 35, lng: 129, moveFromPrev: leg('bus', 20, 1550) },
        { itemId: 'd', name: '은하갈비', lat: 35, lng: 129, moveFromPrev: leg('walk', 15, 0) },
      ],
    },
  ];
  assert.deepEqual(
    dayRows({ route, members: [] }, 1, '#000').map((r) => r.moveLabel),
    [undefined, '택시 40분 · 1인 4,000원', '버스 20분 · 1,550원', '도보 15분'],
  );
});
