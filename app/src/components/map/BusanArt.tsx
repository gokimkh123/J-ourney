import { memo } from "react";
import { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

import type { MapArtPalette } from "../../theme/index.ts";
import { ART_H, ART_W, shade } from "./busanArt.ts";

// 좌표 원본: docs/app/design-mood/source/duo.html · 3번 지시서 부록 C. 캔버스 390 x 510.
const LAND =
  "M0 0H390V236C374 234 364 246 348 246C332 246 326 260 308 260C292 260 286 250 274 252C258 256 254 278 238 284C220 290 214 304 196 310C178 316 170 330 150 332C126 334 112 346 92 346C70 346 54 358 30 356C16 355 8 362 0 364Z";
const ISLE =
  "M146 392C150 372 186 368 204 382C220 394 214 420 194 428C172 436 146 426 142 410C141 402 144 396 146 392Z";

const WAVES = [
  "M40 410q6-5 12 0t12 0",
  "M270 330q6-5 12 0t12 0",
  "M320 400q6-5 12 0t12 0",
  "M60 455q6-5 12 0t12 0",
  "M240 450q6-5 12 0t12 0",
  "M350 300q6-5 12 0",
];
const STARS: [number, number, number][] = [
  [30, 440, 1.4],
  [110, 470, 1],
  [260, 480, 1.3],
  [350, 440, 1.1],
  [330, 350, 1],
  [80, 400, 0.9],
  [200, 470, 1],
];
const TOWN_LIGHTS: [number, number][] = [
  [60, 190], [90, 206], [130, 214], [160, 230], [230, 190], [260, 196], [300, 186], [340, 178], [372, 174],
  [110, 280], [140, 300], [180, 270], [230, 240], [280, 226], [80, 320], [40, 240], [160, 170], [220, 150], [300, 150],
];
const TREES: [number, number, number][] = [
  [30, 170, 1], [150, 180, 0.9], [250, 170, 1], [270, 90, 1.1], [352, 170, 0.9], [120, 240, 0.85], [178, 384, 0.8],
];
const HOUSES: [number, number, string, string][] = [
  [36, 304, "#FFB4A2", "#F27A6B"],
  [52, 296, "#A6D8FF", "#5DA9E9"],
  [44, 318, "#FFE08A", "#F2B84B"],
  [62, 312, "#C7B8FF", "#9A83F0"],
];
const LABELS: [string, number, number][] = [
  ["해운대", 330, 206],
  ["광안리", 296, 306],
  ["영도", 184, 456],
  ["동래", 160, 136],
  ["자갈치", 118, 372],
];

function Tree({ x, y, s, p }: { x: number; y: number; s: number; p: MapArtPalette }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Ellipse cx={0} cy={11} rx={7} ry={2.2} fill={p.shadow} />
      <Rect x={-1.5} y={2} width={3} height={9} rx={1.5} fill={p.trunk} />
      <Circle cx={0} cy={-2} r={8} fill={p.leaf} />
      <Circle cx={-2.5} cy={-4.5} r={3} fill={p.leafHi} />
    </G>
  );
}

function House({ x, y, wall, roof, p }: { x: number; y: number; wall: string; roof: string; p: MapArtPalette }) {
  const w = p.night ? shade(wall, 0.45) : wall;
  const r = p.night ? shade(roof, 0.55) : roof;
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect x={-6} y={-2} width={12} height={10} rx={1.5} fill={w} />
      <Path d="M-8 -1L0 -8L8 -1Z" fill={r} />
      <Rect x={-1.5} y={2} width={3} height={4} fill={p.window} opacity={0.9} />
    </G>
  );
}

/** 부산 그림 지도 배경(정적). 핀·길·캐릭터는 MeetingMap이 위에 얹는다. 좌표는 모두 그림 좌표(390 x 510). */
function BusanArt({ palette: p }: { palette: MapArtPalette }) {
  const night = p.night;
  return (
    <>
      <Defs>
        <RadialGradient id="busanLighthouseGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFD98A" stopOpacity={0.55} />
          <Stop offset="1" stopColor="#FFD98A" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {/* 1 바다. 컨테이너가 캔버스보다 길어도 바다색이 이어지게 넉넉히 */}
      <Rect x={-400} y={-400} width={ART_W + 800} height={ART_H + 1200} fill={p.sea} />
      {WAVES.map((d) => (
        <Path key={d} d={d} stroke={p.wave} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.9} />
      ))}
      {night && STARS.map(([cx, cy, r]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={p.star} opacity={0.8} />)}
      {/* 2 땅 그림자 · 3 땅 */}
      <G transform="translate(0 8)">
        <Path d={LAND} fill={p.landShadow} />
      </G>
      <G transform="translate(0 7)">
        <Path d={ISLE} fill={p.landShadow} />
      </G>
      <Path d={LAND} fill={p.land} />
      <Path d={ISLE} fill={p.land} />
      {/* 4 산 */}
      <Path d="M10 120Q50 50 92 112Z" fill={p.hill1} />
      <Path d="M60 118Q110 30 160 116Z" fill={p.hill2} />
      <Path d="M98 64Q110 52 122 62" stroke={p.snow} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.7} />
      <Path d="M300 130Q330 90 368 128Z" fill={p.hill1} />
      {/* 5 길 */}
      <Path d="M0 200C80 190 150 214 210 196S320 176 390 168" stroke={p.road} strokeWidth={5} strokeLinecap="round" fill="none" />
      <Path d="M200 0C196 80 200 150 190 300" stroke={p.road} strokeWidth={5} strokeLinecap="round" fill="none" />
      {/* 6 동네 불빛(밤) */}
      {night &&
        TOWN_LIGHTS.map(([cx, cy], i) => (
          <Circle key={`t${i}`} cx={cx} cy={cy} r={i % 3 ? 1.6 : 2.2} fill={p.townLight} opacity={i % 2 ? 0.7 : 0.95} />
        ))}
      {/* 7 나무 · 8 집 */}
      {TREES.map(([x, y, s]) => (
        <Tree key={`tree${x}-${y}`} x={x} y={y} s={s} p={p} />
      ))}
      {HOUSES.map(([x, y, wall, roof]) => (
        <House key={`house${x}-${y}`} x={x} y={y} wall={wall} roof={roof} p={p} />
      ))}
      {/* 9 온천장 김 */}
      <G transform="translate(222 118)">
        <Path d="M0 0q-5-6 0-12t0-12" stroke={p.steam} strokeWidth={2.6} strokeLinecap="round" fill="none" />
        <Path d="M8 2q-5-6 0-12t0-12" stroke={p.steam} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </G>
      {/* 10 등대 */}
      <G transform="translate(206 404)">
        {night && (
          <>
            <Path d="M0 -24L56 -40L56 -8Z" fill={p.lighthouseLight} opacity={0.08} />
            <Circle cx={0} cy={-24} r={12} fill="url(#busanLighthouseGlow)" />
          </>
        )}
        <Rect x={-4} y={-22} width={8} height={22} rx={2} fill="#FFFFFF" stroke="#E8A0A0" strokeWidth={1} />
        <Rect x={-4} y={-16} width={8} height={5} fill="#F27A6B" />
        <Path d="M-6 -22h12l-6-7z" fill="#F27A6B" />
      </G>
      {/* 11 광안대교 */}
      <G transform="translate(232 300)">
        {night && <Path d="M0 0L100 -36" stroke={p.bridgeLight} strokeWidth={14} opacity={0.12} fill="none" />}
        <Path d="M0 0L100 -36" stroke={p.bridge} strokeWidth={5} strokeLinecap="round" fill="none" />
        <Path d="M22 -8L22 -30M78 -28L78 -50" stroke={p.bridge} strokeWidth={4} strokeLinecap="round" fill="none" />
        <Path
          d="M0 0Q22 -26 22 -30Q50 -14 78 -50Q80 -40 100 -36"
          stroke={night ? p.bridgeArch : p.bridge}
          strokeWidth={night ? 2.2 : 1.6}
          fill="none"
        />
        {night && (
          <>
            {Array.from({ length: 11 }, (_, i) => (
              <Circle key={`bl${i}`} cx={i * 10} cy={-i * 3.6} r={1.6} fill={p.bridgeLight} />
            ))}
            <Path d="M14 10v8M40 0v10M66 -10v8M90 -20v8" stroke={p.bridgeArch} strokeWidth={2} strokeLinecap="round" opacity={0.5} fill="none" />
          </>
        )}
      </G>
      {/* 12 파라솔 · 배 */}
      <G transform="translate(340 262)">
        <Path d="M-10 0a10 7 0 0 1 20 0z" fill="#FF8FA3" />
        <Path d="M0 0v8" stroke="#8A6A45" strokeWidth={1.6} fill="none" />
      </G>
      <G transform="translate(360 256)">
        <Path d="M-9 0a9 6 0 0 1 18 0z" fill="#FFD84D" />
        <Path d="M0 0v8" stroke="#8A6A45" strokeWidth={1.6} fill="none" />
      </G>
      <G transform="translate(302 410)">
        <Path d="M-14 0h28l-5 7h-18z" fill={p.boat} />
        <Path d="M0 0v-16l10 13z" fill={p.sail} />
        {night && (
          <>
            <Circle cx={-8} cy={3} r={1.6} fill={p.bridgeLight} />
            <Circle cx={6} cy={3} r={1.6} fill={p.bridgeLight} />
          </>
        )}
      </G>
      {/* 14 지명: 글자마다 아래(테두리)·위(채움) 두 겹 */}
      {LABELS.map(([name, x, y]) => (
        <G key={name}>
          <SvgText x={x} y={y} fontSize={14} fontWeight="800" textAnchor="middle" fill={p.labelStroke} stroke={p.labelStroke} strokeWidth={4} strokeLinejoin="round">
            {name}
          </SvgText>
          <SvgText x={x} y={y} fontSize={14} fontWeight="800" textAnchor="middle" fill={p.label}>
            {name}
          </SvgText>
        </G>
      ))}
    </>
  );
}

export default memo(BusanArt);
