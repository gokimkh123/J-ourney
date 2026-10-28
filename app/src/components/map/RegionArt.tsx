import { memo } from "react";
import { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

import type { MapArtPalette } from "../../theme/index.ts";
import { BOATS, HILLS, HOUSES, LABELS, LAND_D, LANDMARKS, STARS, TOWN_LIGHTS, TREES, WAVES } from "./regionArtData.ts";
import { ART_H, ART_W, shade } from "./regionArt.ts";

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

// 광안대교는 실제보다 짧은 두 점 사이를 이 길이로 늘려 그린다(작게 그리면 눈에 안 띈다).
const BRIDGE_LEN = 110;

/**
 * 부산과 둘레 지역 그림 지도 배경(정적). 핀·길·캐릭터는 MeetingMap이 위에 얹는다. 좌표는 모두 그림 좌표(ART_W x ART_H).
 * 땅 모양은 통계청 SGIS 행정구역경계(2018)로 만들었다(공공누리 제1유형). 화면에 출처를 적어야 한다.
 */
function RegionArt({ palette: p, calm = false }: { palette: MapArtPalette; calm?: boolean }) {
  const night = p.night;
  const a = LANDMARKS.bridgeA;
  const b = LANDMARKS.bridgeB;
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const k = BRIDGE_LEN / 100;
  return (
    <>
      <Defs>
        <RadialGradient id="regionLighthouseGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFD98A" stopOpacity={0.55} />
          <Stop offset="1" stopColor="#FFD98A" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {/* 바다. 컨테이너가 그림보다 커도 바다색이 이어지게 넉넉히 */}
      <Rect x={-600} y={-600} width={ART_W + 1200} height={ART_H + 1200} fill={p.sea} />
      {WAVES.map(([x, y]) => (
        <Path key={`w${x}-${y}`} d={`M${x} ${y}q6-5 12 0t12 0`} stroke={p.wave} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.9} />
      ))}
      {!calm && night && STARS.map(([cx, cy, r]) => <Circle key={`s${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={p.star} opacity={0.8} />)}
      {/* 땅 그림자 · 땅 */}
      <G transform="translate(0 8)">
        <Path d={LAND_D} fill={p.landShadow} fillRule="evenodd" />
      </G>
      <Path d={LAND_D} fill={p.land} fillRule="evenodd" />
      {/* 산 */}
      {HILLS.map(([x, y, w, h, alt], i) => (
        <G key={`h${i}`}>
          <Path d={`M${x - w / 2} ${y}Q${x} ${y - h} ${x + w / 2} ${y}Z`} fill={alt ? p.hill2 : p.hill1} />
          {i === 0 && (
            <Path d={`M${x - 12} ${y - h * 0.62}Q${x} ${y - h * 0.8} ${x + 12} ${y - h * 0.62}`} stroke={p.snow} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.7} />
          )}
        </G>
      ))}
      {/* 동네 불빛(밤) */}
      {!calm && night &&
        TOWN_LIGHTS.map(([cx, cy], i) => (
          <Circle key={`t${i}`} cx={cx} cy={cy} r={i % 3 ? 1.6 : 2.2} fill={p.townLight} opacity={i % 2 ? 0.7 : 0.95} />
        ))}
      {/* 나무 · 집 */}
      {!calm && TREES.map(([x, y, s]) => (
        <Tree key={`tree${x}-${y}`} x={x} y={y} s={s} p={p} />
      ))}
      {!calm && HOUSES.map(([x, y, wall, roof]) => (
        <House key={`house${x}-${y}`} x={x} y={y} wall={wall} roof={roof} p={p} />
      ))}
      {/* 온천장 김 */}
      <G transform={`translate(${LANDMARKS.steam[0]} ${LANDMARKS.steam[1]})`}>
        <Path d="M0 0q-5-6 0-12t0-12" stroke={p.steam} strokeWidth={2.6} strokeLinecap="round" fill="none" />
        <Path d="M8 2q-5-6 0-12t0-12" stroke={p.steam} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </G>
      {/* 등대 */}
      <G transform={`translate(${LANDMARKS.lighthouse[0]} ${LANDMARKS.lighthouse[1]})`}>
        {night && (
          <>
            <Path d="M0 -24L56 -40L56 -8Z" fill={p.lighthouseLight} opacity={0.08} />
            <Circle cx={0} cy={-24} r={12} fill="url(#regionLighthouseGlow)" />
          </>
        )}
        <Rect x={-4} y={-22} width={8} height={22} rx={2} fill="#FFFFFF" stroke="#E8A0A0" strokeWidth={1} />
        <Rect x={-4} y={-16} width={8} height={5} fill="#F27A6B" />
        <Path d="M-6 -22h12l-6-7z" fill="#F27A6B" />
      </G>
      {/* 광안대교 */}
      <G transform={`translate(${a[0]} ${a[1]}) rotate(${angle}) scale(${k})`}>
        {night && <Path d="M0 0L100 0" stroke={p.bridgeLight} strokeWidth={14} opacity={0.12} fill="none" />}
        <Path d="M0 0L100 0" stroke={p.bridge} strokeWidth={5} strokeLinecap="round" fill="none" />
        <Path d="M22 0L22 -26M78 0L78 -40" stroke={p.bridge} strokeWidth={4} strokeLinecap="round" fill="none" />
        <Path d="M0 0Q22 -22 22 -26Q50 -10 78 -40Q80 -20 100 0" stroke={night ? p.bridgeArch : p.bridge} strokeWidth={night ? 2.2 : 1.6} fill="none" />
        {night && Array.from({ length: 11 }, (_, i) => <Circle key={`bl${i}`} cx={i * 10} cy={0} r={1.6} fill={p.bridgeLight} />)}
      </G>
      {/* 파라솔 · 배 */}
      <G transform={`translate(${LANDMARKS.para1[0]} ${LANDMARKS.para1[1]})`}>
        <Path d="M-10 0a10 7 0 0 1 20 0z" fill="#FF8FA3" />
        <Path d="M0 0v8" stroke="#8A6A45" strokeWidth={1.6} fill="none" />
      </G>
      <G transform={`translate(${LANDMARKS.para2[0] + 10} ${LANDMARKS.para2[1] - 3})`}>
        <Path d="M-9 0a9 6 0 0 1 18 0z" fill="#FFD84D" />
        <Path d="M0 0v8" stroke="#8A6A45" strokeWidth={1.6} fill="none" />
      </G>
      {BOATS.map(([x, y]) => (
        <G key={`boat${x}-${y}`} transform={`translate(${x} ${y})`}>
          <Path d="M-14 0h28l-5 7h-18z" fill={p.boat} />
          <Path d="M0 0v-16l10 13z" fill={p.sail} />
          {night && (
            <>
              <Circle cx={-8} cy={3} r={1.6} fill={p.bridgeLight} />
              <Circle cx={6} cy={3} r={1.6} fill={p.bridgeLight} />
            </>
          )}
        </G>
      ))}
      {/* 지명: 글자마다 아래(테두리)·위(채움) 두 겹 */}
      {LABELS.map(([name, x, y]) => (
        <G key={name} opacity={calm ? 0.75 : 1}>
          <SvgText x={x} y={y} fontSize={calm ? 12 : 14} fontWeight="800" textAnchor="middle" fill={p.labelStroke} stroke={p.labelStroke} strokeWidth={4} strokeLinejoin="round">
            {name}
          </SvgText>
          <SvgText x={x} y={y} fontSize={calm ? 12 : 14} fontWeight="800" textAnchor="middle" fill={p.label}>
            {name}
          </SvgText>
        </G>
      ))}
    </>
  );
}

export default memo(RegionArt);
