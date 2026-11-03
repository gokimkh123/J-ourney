import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TILE_Z, NEAR_SCALE, scaleLimits, showsRoutes, tileDensityFor, tilesFor, viewRect, zoomForScale } from './tiles.ts';

const PHONE = 3;
// 3배 밀도 폰에서 이 배율·단계의 256px 타일을 몇 배로 늘려 그리는가
const stretch = (scale: number, z: number) => ((360 / 2 ** z) * 1456 * scale * PHONE) / 256;
const levelAt = (scale: number) => zoomForScale(scale, tileDensityFor(scale, PHONE));

test('줄인 화면은 오픈스트리트맵이 그 거리에 정한 단계(정보 적게)', () => {
  assert.equal(tileDensityFor(1, PHONE), 1);
  assert.equal(levelAt(1), 11, '회의 지도 기본');
  assert.equal(levelAt(2), 12, '일정 지도 첫 화면');
});

test('키운 화면은 폰 밀도로 받아 어느 배율에서도 2배보다 덜 늘린다(글자 선명)', () => {
  assert.equal(tileDensityFor(NEAR_SCALE, PHONE), PHONE);
  for (let s = NEAR_SCALE; s <= 60; s *= 1.25) {
    const z = levelAt(s);
    if (z < MAX_TILE_Z) assert.ok(stretch(s, z) < 2, `배율 ${s.toFixed(2)}: ${z}단계 ${stretch(s, z).toFixed(2)}배`);
  }
  assert.equal(levelAt(10), 15, '장소를 눌러 확대');
});

test('끝까지 키우면 17단계(18단계는 지도가 안 보여 뺐다)', () => {
  const { max } = scaleLimits(384, 640);
  assert.equal(levelAt(max), 17);
  assert.ok(stretch(max, 17) < 2, '끝까지 키워도 글자 선명');
});

test('화면 크기 자리에 놓는 자세한 타일은 어느 배율에서도 400dp 안쪽(끝까지 키워도 거대한 칸이 없다)', () => {
  // 굵은 밑 타일(9단계)은 끝까지 키우면 한 장이 수만 dp가 되어 그림 좌표 자리에 둔다(MeetingMap).
  const { min, max } = scaleLimits(384, 360);
  const baseZ = zoomForScale(min, 1);
  const scales = [max];
  for (let s = min; s < max; s *= 1.1) scales.push(s);
  for (const ratio of [1, 2, PHONE]) {
    for (const s of scales) {
      const z = zoomForScale(s, tileDensityFor(s, ratio));
      if (z <= baseZ) continue;
      for (const t of tilesFor(viewRect({ x: 500, y: 450, scale: s }, 384, 360), z, 0)) {
        const dp = Math.max(t.width, t.height) * s;
        assert.ok(dp < 400, `밀도 ${ratio} 배율 ${s.toFixed(2)} ${z}단계: ${dp.toFixed(0)}dp`);
      }
    }
  }
});

test('경로 선: 그 지도의 첫 화면보다 줄이면 숨기고, 첫 화면·키운 화면에서는 보인다', () => {
  // 일정 지도 첫 화면(약 1.44)에서 조금만(10%) 줄여도 숨긴다. 손가락 떨림 정도는 그대로 둔다.
  assert.equal(showsRoutes(1.44, 1.44), true);
  assert.equal(showsRoutes(1.44 * 0.97, 1.44), true);
  assert.equal(showsRoutes(1.44 * 0.9, 1.44), false);
  assert.equal(showsRoutes(1.0, 1.44), false);
  // 회의 지도 첫 화면(약 1)은 그대로 보인다. 장소를 눌러 확대한 화면도 보인다.
  assert.equal(showsRoutes(0.98, 0.98), true);
  assert.equal(showsRoutes(10, 1.44), true);
});
