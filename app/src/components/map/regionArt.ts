// 부산과 둘레 지역 그림 지도의 좌표 계산. react 무관 순수 함수.
// 그림은 통계청 행정구역 경계를 위도·경도에 비례해 그린 것이라(약 16px/km), 위치는 선형 식 하나로 바뀐다.
// 그림 크기와 변환 식은 생성 스크립트(docs/app/map-gen/gen.py)와 같아야 한다.

export const ART_W = 1019;
export const ART_H = 976;

/** 한 화면 폭에 보여 줄 그림 폭. 화면이 넓으면 같은 비율로 더 크게 그린다. */
export const VIEW_W = 390;

export type GeoPoint = { lat: number; lng: number };
export type ArtPoint = { x: number; y: number };
export type ArtViewport = { x: number; y: number; w: number; h: number; scale: number };

const WEST = 128.7;
const NORTH = 35.45;
const PX_PER_LNG = 1456;
const PX_PER_LAT = 1775;

/** 그림 안의 기본 자리(부산역 근처). 보여 줄 점이 없을 때 카메라가 향한다. */
const HOME: GeoPoint = { lat: 35.115, lng: 129.04 };

/** 위도·경도 → 그림 좌표. 그림 밖의 값도 그대로 계산한다(보이지 않을 뿐). */
export function projectGeo(p: GeoPoint): ArtPoint {
  const x = (p.lng - WEST) * PX_PER_LNG;
  const y = (NORTH - p.lat) * PX_PER_LAT;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return projectGeo(HOME);
  return { x, y };
}

/** 그림 좌표 → 위도·경도(projectGeo의 반대). 지도 타일을 고를 때 쓴다. */
export function unprojectGeo(p: ArtPoint): GeoPoint {
  return { lat: NORTH - p.y / PX_PER_LAT, lng: WEST + p.x / PX_PER_LNG };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const finitePoints = (points: ArtPoint[]) => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

/** 카메라 가운데: 점들의 범위 [lo, hi]가 size 안에 들면 가운데에, 아니면 lo부터 */
function place(lo: number, hi: number, size: number): number {
  return hi - lo <= size ? (lo + hi) / 2 - size / 2 : lo;
}

/** 가장 위 점 위에 남겨 둘 화면 픽셀(말하는 캐릭터와 말풍선 자리) */
const TOP_ROOM_PX = 120;
/** 가장 아래 점 아래 여백(화면 픽셀) */
const BOTTOM_ROOM_PX = 24;
/** 좌우 가장자리 점 옆 여백(깃발과 옆에 선 캐릭터가 잘리지 않게) */
const SIDE_ROOM_PX = 56;
const FIT_PAD = 24;
const FIT_FLAG_ROOM = 28;
const FIT_MAX_SCALE = 2.2;

/**
 * 그림 좌표(points)가 다 보이도록 그림에서 보여 줄 사각형을 정한다.
 * full: 폭 VIEW_W(화면 폭에 맞춘 배율)로 고정하고 위치만 맞춘다.
 *   점이 한 화면보다 넓게 흩어지면 focus(있으면)를 우선 담고, focus가 없으면 왼쪽·위쪽 점부터 맞춘다.
 * fit: 점들을 감싸게 확대(최대 2.2배)한다.
 */
export function computeArtViewport(
  points: ArtPoint[],
  containerW: number,
  containerH: number,
  view: 'full' | 'fit',
  focus: ArtPoint[] = [],
): ArtViewport {
  const cw = containerW > 0 ? containerW : VIEW_W;
  const ch = containerH > 0 ? containerH : ART_H;
  const finite = finitePoints(points);

  if (view === 'full' || finite.length === 0) {
    const scale = cw / VIEW_W;
    const w = VIEW_W;
    const h = ch / scale;
    let x: number;
    let y: number;
    if (finite.length === 0) {
      const home = projectGeo(HOME);
      x = home.x - w / 2;
      y = home.y - h / 2;
    } else {
      const range = (pts: ArtPoint[]) => {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        return {
          x0: Math.min(...xs) - SIDE_ROOM_PX / scale,
          x1: Math.max(...xs) + SIDE_ROOM_PX / scale,
          y0: Math.min(...ys) - TOP_ROOM_PX / scale,
          y1: Math.max(...ys) + BOTTOM_ROOM_PX / scale,
        };
      };
      let r = range(finite);
      const spare = finitePoints(focus);
      // 다 담을 수 없으면 지금 움직이는 점(focus)을 먼저 담는다.
      if (spare.length > 0 && (r.x1 - r.x0 > w || r.y1 - r.y0 > h)) r = range(spare);
      x = place(r.x0, r.x1, w);
      y = place(r.y0, r.y1, h);
    }
    return { x: clamp(x, 0, ART_W - w), y: clamp(y, 0, ART_H - h), w, h, scale };
  }

  const minX = Math.min(...finite.map((p) => p.x)) - FIT_PAD;
  const maxX = Math.max(...finite.map((p) => p.x)) + FIT_PAD;
  // 깃발은 발(점) 위로 솟아 있으므로 위쪽에 깃발 높이만큼 더 둔다.
  const minY = Math.min(...finite.map((p) => p.y)) - FIT_PAD - FIT_FLAG_ROOM;
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

/** 카메라가 새 위치로 옮겨 갈 만큼 어긋나야 하는 최소 거리(화면 픽셀). 이보다 작은 어긋남은 그대로 둔다. */
const CAMERA_DEADBAND_PX = 40;

/**
 * 회의 지도('full')에서 카메라(그림이 보이는 왼쪽 위 모서리, 그림 좌표)를 정한다.
 * 점이 조금 움직일 때마다 지도가 따라 흔들리지 않게, 필요한 만큼 어긋났을 때만 새 위치를 돌려주고 아니면 prev를 그대로 준다.
 * speaker(말하는 캐릭터)가 있으면 말풍선 자리까지 늘 화면 안에 두고, 그 캐릭터가 지금 화면 밖이면 어긋남이 작아도 옮긴다.
 * 새 위치로 가는 부드러운 이동은 화면(MeetingMap)이 맡는다.
 */
export function cameraXY(
  prev: ArtPoint | null,
  points: ArtPoint[],
  containerW: number,
  containerH: number,
  focus: ArtPoint[] = [],
  speaker: ArtPoint | null = null,
): ArtPoint {
  const view = computeArtViewport(points, containerW, containerH, 'full', focus);
  const ideal = speaker === null ? { x: view.x, y: view.y } : keepInView({ x: view.x, y: view.y }, speaker, view);
  if (prev === null) return ideal;
  if (speaker !== null && !inView(prev, speaker, view)) return ideal;
  return Math.hypot(ideal.x - prev.x, ideal.y - prev.y) * view.scale < CAMERA_DEADBAND_PX ? prev : ideal;
}

/** 이 점이 카메라 화면 안에 여백(위는 말풍선 자리)까지 들어오는 범위 [lo, hi] */
function roomFor(p: ArtPoint, view: ArtViewport): { x0: number; x1: number; y0: number; y1: number } {
  const side = SIDE_ROOM_PX / view.scale;
  return {
    x0: p.x + side - view.w,
    x1: p.x - side,
    y0: p.y + BOTTOM_ROOM_PX / view.scale - view.h,
    y1: p.y - TOP_ROOM_PX / view.scale,
  };
}

function inView(cam: ArtPoint, p: ArtPoint, view: ArtViewport): boolean {
  const r = roomFor(p, view);
  return cam.x >= r.x0 && cam.x <= r.x1 && cam.y >= r.y0 && cam.y <= r.y1;
}

/** 카메라를 가장 적게 옮겨 이 점(말하는 캐릭터)이 여백까지 화면 안에 들게 한다. 그림 밖으로는 나가지 않는다. */
function keepInView(cam: ArtPoint, p: ArtPoint, view: ArtViewport): ArtPoint {
  const r = roomFor(p, view);
  return {
    x: clamp(clamp(cam.x, r.x0, r.x1), 0, ART_W - view.w),
    y: clamp(clamp(cam.y, r.y0, r.y1), 0, ART_H - view.h),
  };
}

type Cubic = { p1: ArtPoint; c1: ArtPoint; c2: ArtPoint; p2: ArtPoint };

/** Catmull-Rom 곡선 구간들(점 n개 → 구간 n-1개) */
function smoothCubics(points: ArtPoint[]): Cubic[] {
  const pts = finitePoints(points);
  const cubics: Cubic[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    cubics.push({
      p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    });
  }
  return cubics;
}

/** 점들을 Catmull-Rom 곡선으로 잇는 SVG path. 점이 2개 미만이면 빈 문자열. */
export function smoothPath(points: ArtPoint[]): string {
  const cubics = smoothCubics(points);
  if (cubics.length === 0) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(cubics[0]!.p1.x)} ${f(cubics[0]!.p1.y)}`;
  for (const { c1, c2, p2 } of cubics) d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  return d;
}

/** 꺾쇠를 놓아 볼 자리(구간 안 비율). 가운데가 가려지면 양옆으로 조금씩 옮긴다. */
const ARROW_TS = [0.5, 0.38, 0.62, 0.28, 0.72];

/**
 * smoothPath 각 구간에 놓을 방향 꺾쇠의 자리와 가는 방향(도, 0°=오른쪽, 시계 방향).
 * 가운데부터 놓아 보고 isClear가 false면(장소 스티커에 가려지면) 옆자리로, 다 가려지면 그 구간은 뺀다.
 * length는 구간 양 끝의 직선 거리(짧은 구간은 꺾쇠를 빼려고).
 */
export function pathMidArrows(
  points: ArtPoint[],
  isClear: (p: ArtPoint) => boolean = () => true,
): { x: number; y: number; deg: number; length: number }[] {
  const arrows: { x: number; y: number; deg: number; length: number }[] = [];
  for (const { p1, c1, c2, p2 } of smoothCubics(points)) {
    for (const t of ARROW_TS) {
      const u = 1 - t;
      const at = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
      const tan = (a: number, b: number, c: number, d: number) => u * u * (b - a) + 2 * u * t * (c - b) + t * t * (d - c);
      const p = { x: at(p1.x, c1.x, c2.x, p2.x), y: at(p1.y, c1.y, c2.y, p2.y) };
      if (!isClear(p)) continue;
      const deg = (Math.atan2(tan(p1.y, c1.y, c2.y, p2.y), tan(p1.x, c1.x, c2.x, p2.x)) * 180) / Math.PI;
      arrows.push({ ...p, deg, length: Math.hypot(p2.x - p1.x, p2.y - p1.y) });
      break;
    }
  }
  return arrows;
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
