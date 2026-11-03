// 오픈스트리트맵 타일(256px 정사각형 그림)을 그림 지도 좌표(regionArt.ts의 projectGeo) 위에 까는 계산. react 무관 순수 함수.
// 그림 좌표는 위도·경도에 비례한 값이고 타일은 메르카토르라, 타일마다 네 모서리를 그림 좌표로 바꿔 그 사각형에 그린다(부산 크기에서는 어긋남이 1px 안팎).

import { projectGeo, unprojectGeo, type ArtPoint } from './regionArt.ts';

export type TileRect = { key: string; z: number; x: number; y: number; left: number; top: number; width: number; height: number };
/** 카메라: 화면 왼쪽 위 모서리의 그림 좌표(x, y)와 배율(화면 px / 그림 px) */
export type MapCamera = { x: number; y: number; scale: number };
export type ArtRect = { x0: number; y0: number; x1: number; y1: number };

export const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
/** 오픈스트리트맵 타일 사용 정책: 앱을 알 수 있는 이름을 붙여 받는다. */
export const TILE_HEADERS = { 'User-Agent': 'J-ourney/0.1 (DevDay 2026 demo app)' };
export const TILE_CREDIT = '© OpenStreetMap contributors';

/** 타일 확대 단계 한도: 부산 전체(9)부터 골목(17)까지 */
export const MIN_TILE_Z = 9;
export const MAX_TILE_Z = 17;

/** 목적지 범위(부산광역시 둘레, 위도·경도). 끌 수 있는 범위와 가장 작게 줄였을 때의 기준이다. */
export const DESTINATION = { north: 35.39, south: 34.88, west: 128.76, east: 129.31 };

/** 그림 1px에 해당하는 경도(도). 그림 좌표는 경도에 비례한다. */
const LNG_PER_ART_PX = (() => {
  const a = projectGeo({ lat: 35, lng: 129 });
  const b = projectGeo({ lat: 35, lng: 130 });
  return 1 / (b.x - a.x);
})();

// 손가락 동작 계산(clampCamera·zoomAround)은 화면 쪽 스레드(worklet)에서도 돌므로 'worklet' 표시를 붙인다(일반 호출에는 영향 없음).
function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(Math.max(v, lo), hi);
}

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * 이 배율(화면 px / 그림 px)에서 타일이 화면에 256px보다 조금 크게(선명하게) 보이는 확대 단계.
 * 폰 화면은 촘촘해서(pixelRatio) 한 단계 더 높인다.
 */
export function zoomForScale(scale: number, pixelRatio = 2): number {
  const tileArtW = (z: number) => (360 / 2 ** z) / LNG_PER_ART_PX;
  const want = 256 / Math.max(1, Math.min(pixelRatio, 3) / 1.5);
  let z = MIN_TILE_Z;
  while (z < MAX_TILE_Z && tileArtW(z) * scale > want * 1.4) z += 1;
  return z;
}

/** 화면에 보이는 그림 범위 */
export function viewRect(cam: MapCamera, viewW: number, viewH: number): ArtRect {
  return { x0: cam.x, y0: cam.y, x1: cam.x + viewW / cam.scale, y1: cam.y + viewH / cam.scale };
}

/** 그림 범위(둘레 margin칸 더)를 덮는 z단계 타일들과 각 타일을 그릴 그림 좌표 사각형 */
export function tilesFor(rect: ArtRect, z: number, margin = 1): TileRect[] {
  const nw = unprojectGeo({ x: rect.x0, y: rect.y0 });
  const se = unprojectGeo({ x: rect.x1, y: rect.y1 });
  const n = 2 ** z;
  const tx0 = clamp(Math.floor(lngToTileX(nw.lng, z)) - margin, 0, n - 1);
  const tx1 = clamp(Math.floor(lngToTileX(se.lng, z)) + margin, 0, n - 1);
  const ty0 = clamp(Math.floor(latToTileY(nw.lat, z)) - margin, 0, n - 1);
  const ty1 = clamp(Math.floor(latToTileY(se.lat, z)) + margin, 0, n - 1);
  const out: TileRect[] = [];
  for (let x = tx0; x <= tx1; x++) {
    for (let y = ty0; y <= ty1; y++) {
      const a = projectGeo({ lat: tileYToLat(y, z), lng: tileXToLng(x, z) });
      const b = projectGeo({ lat: tileYToLat(y + 1, z), lng: tileXToLng(x + 1, z) });
      out.push({ key: `${z}/${x}/${y}`, z, x, y, left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y });
    }
  }
  return out;
}

/** 목적지 범위의 그림 좌표 사각형 */
export function destinationRect(): ArtRect {
  const a = projectGeo({ lat: DESTINATION.north, lng: DESTINATION.west });
  const b = projectGeo({ lat: DESTINATION.south, lng: DESTINATION.east });
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/** 목적지 전체가 한 화면에 들어오는 배율보다 이만큼 더 줄일 수 있다(11/3: 둘레 지역까지 보이게 더 줄이기) */
const ZOOM_OUT_MORE = 0.4;

/** 확대 한도: 가장 작게는 목적지 전체가 한 화면에 들어오는 배율의 0.4배(둘레까지), 가장 크게는 골목이 보이는 배율 */
export function scaleLimits(viewW: number, viewH: number, dest: ArtRect = destinationRect()): { min: number; max: number } {
  const min = Math.min(viewW / (dest.x1 - dest.x0), viewH / (dest.y1 - dest.y0)) * ZOOM_OUT_MORE;
  const max = (256 * 2 ** (MAX_TILE_Z - 1)) / (360 / LNG_PER_ART_PX);
  return { min, max: Math.max(min, max) };
}

/**
 * 끌 수 있는 범위로 카메라를 맞춘다. 화면 가운데가 목적지 범위에서 (화면 반 폭·반 높이 + 10%)까지만 나갈 수 있어,
 * 가장 끝까지 끌면 목적지가 화면에서 완전히 빠진다(11/2 결정).
 */
export function clampCamera(cam: MapCamera, viewW: number, viewH: number, dest: ArtRect = destinationRect()): MapCamera {
  'worklet';
  const halfW = viewW / 2 / cam.scale;
  const halfH = viewH / 2 / cam.scale;
  const cx = clamp(cam.x + halfW, dest.x0 - halfW * 1.1, dest.x1 + halfW * 1.1);
  const cy = clamp(cam.y + halfH, dest.y0 - halfH * 1.1, dest.y1 + halfH * 1.1);
  return { x: cx - halfW, y: cy - halfH, scale: cam.scale };
}

/** 두 손가락 확대: 손가락 가운데(화면 좌표 fx, fy) 아래의 그림 점이 그대로 있게 배율을 바꾼다. */
export function zoomAround(cam: MapCamera, nextScale: number, fx: number, fy: number): MapCamera {
  'worklet';
  const p: ArtPoint = { x: cam.x + fx / cam.scale, y: cam.y + fy / cam.scale };
  return { x: p.x - fx / nextScale, y: p.y - fy / nextScale, scale: nextScale };
}

/** 한 점을 화면 가운데에 두는 카메라(일정 탭에서 장소를 눌렀을 때) */
export function cameraOn(p: ArtPoint, scale: number, viewW: number, viewH: number): MapCamera {
  return { x: p.x - viewW / 2 / scale, y: p.y - viewH / 2 / scale, scale };
}
