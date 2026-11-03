import assert from 'node:assert/strict';
import test from 'node:test';

import type { RouteDay, RouteStop } from '../meeting/types.ts';
import { dayRows, mapSignature } from './chosenPlan.ts';

function stop(id: string, extra: Partial<RouteStop> = {}): RouteStop {
  return { itemId: `i_${id}`, placeId: `plc_${id}`, name: `${id} 이름`, lat: 35.1, lng: 129.1, kind: 'sight', moveFromPrev: null, ...extra };
}

const route: RouteDay[] = [{ day: 1, stops: [stop('a'), stop('b', { lat: 35.2 }), stop('c', { lng: 129.3 })] }];
const rowsOf = (r: RouteDay[], fixed: Record<string, number> = {}) => dayRows({ route: r, members: [] }, 1, '#000', fixed);

test('같은 일정이면 새로 만든 줄이어도 같은 글이다', () => {
  assert.equal(mapSignature(rowsOf(route)), mapSignature(rowsOf(structuredClone(route))));
});

test('시각만 바뀌면 지도는 그대로다', () => {
  assert.equal(mapSignature(rowsOf(route)), mapSignature(rowsOf(route, { plc_b: 14 * 60 })));
});

test('순서·자리·이름이 바뀌면 다른 글이다', () => {
  const base = mapSignature(rowsOf(route));
  const [a, b, c] = route[0]!.stops;
  assert.notEqual(base, mapSignature(rowsOf([{ day: 1, stops: [b!, a!, c!] }])));
  assert.notEqual(base, mapSignature(rowsOf([{ day: 1, stops: [a!, { ...b!, lat: 35.25 }, c!] }])));
  assert.notEqual(base, mapSignature(rowsOf([{ day: 1, stops: [a!, { ...b!, name: '다른 곳' }, c!] }])));
  assert.notEqual(base, mapSignature(rowsOf([{ day: 1, stops: [a!, b!] }])));
});
