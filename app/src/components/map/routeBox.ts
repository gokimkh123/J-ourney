// 지도 경로 선을 그릴 SVG 판의 자리와 크기 계산. react 무관 순수 함수.
// react-native-svg는 안드로이드에서 판 전체를 픽셀 크기 비트맵 한 장으로 그리고, 무엇이 바뀌면 새로 만든다.
// 판을 그림 전체(1019×976)로 두면 폰에서 30MB 안팎의 비트맵을 장소를 누를 때마다 다시 만들어 화면이 끊겼다(11/3).

import type { ArtPoint } from './regionArt.ts';

export type ArtBox = { x: number; y: number; w: number; h: number };

/**
 * 경로 점을 모두 덮는 그림 좌표 사각형. 선 굵기·방향 꺾쇠(화면 24px 안쪽)와
 * 곡선(Catmull-Rom)이 점 밖으로 부푸는 몫(큰 쪽 길이의 1/6)만큼 둘레를 둔다. px는 화면 px / 그림 px. 점이 없으면 null.
 */
export function routeBox(points: readonly ArtPoint[], px: number): ArtBox | null {
  if (points.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = 24 / (px > 0 ? px : 1) + Math.max(x1 - x0, y1 - y0) / 6;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
