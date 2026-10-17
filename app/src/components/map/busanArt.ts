// 부산 그림 지도의 좌표 계산. react 무관 순수 함수.
// 그림은 실제 지리와 다르게 그린 390 x 510 캔버스라서, 앵커 점 사이를 보간해 위도·경도를 그림 좌표로 바꾼다.

export const ART_W = 390;
export const ART_H = 510;

export type GeoPoint = { lat: number; lng: number };
export type ArtPoint = { x: number; y: number };
export type ArtViewport = { x: number; y: number; w: number; h: number; scale: number };

type Anchor = GeoPoint & ArtPoint;

export const BUSAN_ANCHORS: Anchor[] = [
  { lat: 35.0969, lng: 129.0306, x: 100, y: 340 }, // 자갈치시장
  { lat: 35.115, lng: 129.0403, x: 118, y: 318 }, // 부산역
  { lat: 35.085, lng: 129.07, x: 176, y: 404 }, // 영도
  { lat: 35.1578, lng: 129.0594, x: 160, y: 214 }, // 서면
  { lat: 35.2048, lng: 129.0837, x: 198, y: 126 }, // 동래
  { lat: 35.1496, lng: 129.1189, x: 232, y: 300 }, // 남천·광안대교 시작
  { lat: 35.1532, lng: 129.1186, x: 256, y: 276 }, // 광안리 해변
  { lat: 35.1587, lng: 129.1604, x: 322, y: 250 }, // 해운대 해수욕장
];

// 부산 위도에서 경도 1도는 위도 1도보다 짧다.
const LNG_SCALE = Math.cos((35.1 * Math.PI) / 180);

/** 역거리 가중(거듭제곱 2) 보간. 앵커에서는 그 앵커의 그림 좌표가 그대로 나온다. */
export function projectBusan(p: GeoPoint): ArtPoint {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const a of BUSAN_ANCHORS) {
    const dLat = p.lat - a.lat;
    const dLng = (p.lng - a.lng) * LNG_SCALE;
    const d2 = dLat * dLat + dLng * dLng;
    if (d2 < 1e-12) return { x: a.x, y: a.y };
    const w = 1 / d2;
    sw += w;
    sx += w * a.x;
    sy += w * a.y;
  }
  if (!(sw > 0) || !Number.isFinite(sw)) return { x: ART_W / 2, y: ART_H / 2 };
  return { x: sx / sw, y: sy / sw };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** 'full'에서 가장 위 점 위에 남겨 둘 화면 픽셀(말하는 캐릭터와 말풍선 자리) */
const TOP_ROOM_PX = 120;
/** 'full'에서 가장 아래 점 아래 여백(화면 픽셀) */
const BOTTOM_ROOM_PX = 24;
const FIT_PAD = 24;
const FIT_MAX_SCALE = 2.2;

/**
 * 그림 좌표(points)가 다 보이도록 캔버스에서 보여 줄 사각형을 정한다.
 * full: 폭 390 전체를 보여 주고 세로 위치만 맞춘다(컨테이너가 더 길면 바다색이 남는다).
 * fit: 점들을 감싸게 확대(최대 2.2배)한다.
 */
export function computeArtViewport(
  points: ArtPoint[],
  containerW: number,
  containerH: number,
  view: 'full' | 'fit',
): ArtViewport {
  const cw = containerW > 0 ? containerW : ART_W;
  const ch = containerH > 0 ? containerH : ART_H;
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (view === 'full' || finite.length === 0) {
    const scale = cw / ART_W;
    const h = ch / scale;
    if (finite.length === 0 || h >= ART_H) return { x: 0, y: 0, w: ART_W, h, scale };
    const minY = Math.min(...finite.map((p) => p.y)) - TOP_ROOM_PX / scale;
    const maxY = Math.max(...finite.map((p) => p.y)) + BOTTOM_ROOM_PX / scale;
    const y = maxY - minY <= h ? (minY + maxY) / 2 - h / 2 : minY;
    return { x: 0, y: clamp(y, 0, ART_H - h), w: ART_W, h, scale };
  }

  const minX = Math.min(...finite.map((p) => p.x)) - FIT_PAD;
  const maxX = Math.max(...finite.map((p) => p.x)) + FIT_PAD;
  const minY = Math.min(...finite.map((p) => p.y)) - FIT_PAD;
  const maxY = Math.max(...finite.map((p) => p.y)) + FIT_PAD;
  const aspect = cw / ch;
  let w = Math.max(maxX - minX, cw / FIT_MAX_SCALE);
  let h = w / aspect;
  if (h < maxY - minY) {
    h = maxY - minY;
    w = h * aspect;
  }
  if (w > ART_W) {
    w = ART_W;
    h = w / aspect;
  }
  if (h > ART_H) {
    h = ART_H;
    w = h * aspect;
  }
  const x = clamp((minX + maxX) / 2 - w / 2, 0, ART_W - w);
  const y = clamp((minY + maxY) / 2 - h / 2, 0, ART_H - h);
  return { x, y, w, h, scale: cw / w };
}

/** 점들을 Catmull-Rom 곡선으로 잇는 SVG path. 점이 2개 미만이면 빈 문자열. */
export function smoothPath(points: ArtPoint[]): string {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** #RRGGBB의 밝기를 k배로. 집·깃발 테두리 색에 쓴다. 잘못된 값은 그대로. */
export function shade(hex: string, k: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}
