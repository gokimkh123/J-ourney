import test from 'node:test';
import assert from 'node:assert/strict';

import { initialMeetingState } from './reducer.ts';
import type { MeetingState, RouteDay, RouteStop } from './types.ts';
import { routeMapView, withOtherCandidates } from './view.ts';

const state: MeetingState = {
  ...initialMeetingState(),
  agents: [{ agentId: 'agt_1', memberId: 'u1', nickname: '민수', title: '', chips: [], color: '#F97316' }],
};

function stop(id: string, lat: number, extra: Partial<RouteStop> = {}): RouteStop {
  return { itemId: `i_${id}`, placeId: `plc_${id}`, name: `${id} 이름`, lat, lng: 129, kind: 'sight', ...extra };
}

const hotel = (itemId: string) => stop('hotel', 35.5, { itemId, kind: 'lodging' });

const ROUTE: RouteDay[] = [
  { day: 2, stops: [hotel('i_h2'), stop('c', 35.3), stop('d', 35.4, { kind: 'food', meal: 'lunch' })] },
  { day: 1, stops: [stop('a', 35.1, { mustFor: ['u1'] }), stop('b', 35.2, { kind: 'food', meal: 'lunch' }), hotel('i_h1')] },
];

test('그날만 그리면 시트 목록처럼 1부터 번호를 매기고, 식당·숙소도 스티커가 된다', () => {
  const view = routeMapView(state, ROUTE, 1);
  // 분류가 없는 관광지와 숙소는 기본 스티커(pin), 끼니 식당은 food
  assert.deepEqual(
    view.pins.map((p) => [p.label, p.name, p.kind]),
    [
      ['1', 'a 이름', 'pin'],
      ['2', 'b 이름', 'food'],
      ['3', 'hotel 이름', 'pin'],
    ],
  );
  assert.equal(view.lines.length, 1);
});

test('정류장 색은 꼭 가거나 좋아한 구성원의 AI 색, 없으면 기본 색', () => {
  const [a, b] = routeMapView(state, ROUTE, 1).pins;
  assert.equal(a!.color, '#F97316');
  assert.equal(b!.color, '#8B95A1');
});

test('모든 날을 그리면 날 순서로 번호를 잇고, 날 끝·다음 날 처음의 같은 숙소는 스티커 하나다', () => {
  const view = routeMapView(state, ROUTE, null);
  assert.deepEqual(
    view.pins.map((p) => p.label + ' ' + p.name),
    ['1 a 이름', '2 b 이름', '3 hotel 이름', '4 c 이름', '5 d 이름'],
  );
  assert.equal(view.lines.length, 2);
});

test('선의 모든 점이 스티커 자리라서 아이콘이 모두 선으로 이어진다', () => {
  for (const day of [1, 2, null]) {
    const view = routeMapView(state, ROUTE, day);
    const at = new Set(view.pins.map((p) => `${p.lat},${p.lng}`));
    for (const point of view.lines.flat()) assert.ok(at.has(`${point.lat},${point.lng}`));
    // 선이 지나지 않는 스티커도 없다
    const onLine = new Set(view.lines.flat().map((p) => `${p.lat},${p.lng}`));
    for (const pin of view.pins) assert.ok(onLine.has(`${pin.lat},${pin.lng}`));
  }
});

test('회의 도중에는 일정에 없는 후보를 번호 없이 뒤에 남기고, 같은 곳은 정류장 스티커 하나만', () => {
  const routePins = routeMapView(state, ROUTE, 1).pins;
  const candidates = [
    { id: 'plc_a', name: 'a 이름', lat: 35.1, lng: 129, color: '#000', label: '7' },
    { id: 'plc_x', name: '바다 이름', lat: 35.0, lng: 129, color: '#000', label: '9' },
    { id: 'plc_other_id', name: 'b 이름', lat: 35.2, lng: 129, color: '#000' },
  ];
  const pins = withOtherCandidates(routePins, candidates);
  assert.deepEqual(
    pins.map((p) => p.id),
    ['plc_a', 'plc_b', 'plc_hotel', 'plc_x'],
  );
  assert.equal('label' in pins[3]!, false);
});

test('일정이 없거나 없는 날이면 빈 지도', () => {
  assert.deepEqual(routeMapView(state, [], null), { pins: [], lines: [] });
  assert.deepEqual(routeMapView(state, ROUTE, 3), { pins: [], lines: [] });
});
