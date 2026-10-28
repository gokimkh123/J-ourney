import { useEffect, useMemo, useRef, useState } from "react";
import { Animated as RNAnimated, Easing as RNEasing, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ZoomIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

import { duration, easing, lightColors, mapArtPalettes, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { fullAvatarSize, type AvatarChip } from "./Avatar.tsx";
import PlaceSticker, { type PlaceKind } from "./PlaceSticker.tsx";
import RegionArt from "./map/RegionArt.tsx";
import Flag, { FLAG_FOOT, FLAG_H, FLAG_W } from "./map/Flag.tsx";
import { spreadPoints } from "./map/spreadPoints.ts";
import { walkMs } from "./map/walk.ts";
import { ART_H, ART_W, VIEW_W, cameraXY, computeArtViewport, projectGeo, smoothPath, type ArtPoint, type ArtViewport } from "./map/regionArt.ts";

export type LatLng = { lat: number; lng: number };
export type MapBounds = { north: number; south: number; east: number; west: number };

export type MapPin = LatLng & {
  id: string;
  /** 처음 제안한 구성원 색 */
  color: string;
  /** 일정 순서 번호 등 핀 머리에 들어갈 짧은 글자 */
  label?: string;
  /** 읽어 주기용 장소 이름 */
  name?: string;
  /** 조용한 지도(calm)에서 스티커 모양을 정하는 장소 종류 */
  kind?: PlaceKind;
};

export type MapAgent = LatLng & {
  id: string;
  name: string;
  color: string;
  chips?: AvatarChip[];
  /** 조사 중이면 발밑에 퍼지는 원 */
  searching?: boolean;
  /** 걷는 속도 배수(기본 1). 밀린 핀을 따라잡을 때 올라간다. */
  speed?: number;
};

export type MapRoute = { color: string; points: LatLng[] };

export type MeetingMapProps = {
  bounds: MapBounds;
  pins?: MapPin[];
  agents?: MapAgent[];
  routes?: MapRoute[];
  /** 말풍선: 어떤 AI 위에 무슨 말 */
  bubble?: { agentId: string; text: string } | null;
  /** 목적지 해안선 등 간단한 땅 모양(선택). 없으면 격자만 그린다. */
  land?: LatLng[][];
  /** 'busan'이면 격자 대신 부산과 둘레 지역을 그린 그림 지도(낮·밤)와 깃발 핀을 쓴다. 이때 bounds·land는 무시한다. */
  art?: "busan";
  /** 그림 지도에서 'full'은 한 화면 폭으로 보여 주며 카메라가 핀을 따라 옮겨 다니고(회의 진행), 'fit'은 핀·경로가 들어오게 확대한다(일정 위쪽 작은 지도) */
  artView?: "full" | "fit";
  height?: number;
  /** 지도 그림을 어디에 맞출지 계산할 때 쓰는 높이. 생략하면 height. 아래를 시트가 가릴 때 보이는 부분 높이를 준다. */
  viewHeight?: number;
  /** 일정 지도처럼 조용하게: 집·나무를 빼고, 핀은 장소 스티커로 서로 겹치지 않게 벌리고, 길은 그 스티커를 순서대로 잇는다. 그림 지도(art)에서만 쓴다. */
  calm?: boolean;
  accessibilityLabel?: string;
};

const PAD = spacing.lg; // 가장자리 핀이 잘리지 않게
const PIN_W = 24;
const PIN_H = 32;
// 지도 위 캐릭터는 전신(sm ≈ 50px). 말하는 중이면 1.25배로 커진다.
const AGENT = fullAvatarSize("sm");
const AGENT_ACTIVE_H = Math.round(AGENT.height * 1.25);
// 위쪽 가장자리에서 말하는 캐릭터가 잘리지 않게 위 여백을 더 둔다.
const PAD_TOP = AGENT_ACTIVE_H + spacing.xs;
// 캐릭터는 핀 오른쪽 바닥에 서 있게 해서 핀 번호를 가리지 않는다.
const AGENT_OFFSET = { x: PIN_W / 2 + AGENT.width / 2 - 2, y: 0 };
// 핀 머리 안은 늘 흰 바탕이라 글자는 모드와 상관없이 어둡게.
const PIN_INK = lightColors.text;
// 그림 지도에서 캐릭터는 깃발 오른쪽 바닥에 선다. 깃발 천의 번호가 가려지지 않게 천 중간부터 시작한다.
const ART_AGENT_DX = 14 + AGENT.width / 2;
const PIN_STROKE = lightColors.textOnColor;
// 가까이 모인 캐릭터는 이 간격으로 좌우로 벌린다.
// 몸이 겹칠 만큼 가까우면 캐릭터 폭만큼 좌우로 벌려 세운다(서로 가리지 않게).
const FAN_RADIUS = AGENT.width;
const FAN_STEP = AGENT.width + 6;
// 누가 말하는 중일 때 나머지 캐릭터는 흐리게 두어 말하는 캐릭터가 눈에 들어오게 한다.
const DIM_OPACITY = 0.55;

/** 위도·경도 묶음을 감싸는 범위. 화면이 bounds를 만들 때 쓴다. margin은 비율. */
export function boundsAround(points: LatLng[], margin = 0.12): MapBounds {
  if (points.length === 0) return { north: 1, south: 0, east: 1, west: 0 };
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  const dLat = Math.max(north - south, 0.005) * margin;
  const dLng = Math.max(east - west, 0.005) * margin;
  return { north: north + dLat, south: south - dLat, east: east + dLng, west: west - dLng };
}

function project(p: LatLng, b: MapBounds, w: number, h: number): { x: number; y: number } {
  const spanLng = b.east - b.west || 1;
  const spanLat = b.north - b.south || 1;
  return {
    x: PAD + ((p.lng - b.west) / spanLng) * (w - PAD * 2),
    y: PAD_TOP + ((b.north - p.lat) / spanLat) * (h - PAD_TOP - PAD),
  };
}

// 카메라(지도 이동)가 새 위치로 옮겨 가는 시간
const CAMERA_MS = 900;

const travelEasing = Easing.bezier(easing.travel[0], easing.travel[1], easing.travel[2], easing.travel[3]);

/** 말하는 캐릭터에게 붙는 말풍선 내용. 캐릭터 안에 들어가서 걷는 동안에도 머리 위에 붙어 다닌다. */
type AgentBubble = { speaker: string; text: string; mapWidth: number; leftInset: number; topInset: number };

/** x, y는 캐릭터 발 위치(바닥 가운데). */
function AgentMarker({
  agent,
  x,
  y,
  active,
  dim = false,
  bubble,
}: {
  agent: MapAgent;
  x: number;
  y: number;
  active: boolean;
  dim?: boolean;
  bubble?: AgentBubble;
}) {
  const styles = useStyles(createStyles);
  const reduce = useReducedMotion();
  const tx = useSharedValue(x);
  const ty = useSharedValue(y);

  const pulse = useSharedValue(0);
  const bob = useSharedValue(0);

  // 서 있는 동안에도 살짝 통통 튀어 살아 있는 느낌을 준다(말하는 중이면 더 크게). 모션 줄이기 설정이면 멈춘다.
  useEffect(() => {
    if (reduce) {
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(withTiming(1, { duration: active ? 420 : 780, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [active, reduce, bob]);

  const last = useRef({ x, y });
  useEffect(() => {
    const dist = Math.hypot(x - last.current.x, y - last.current.y);
    last.current = { x, y };
    const walk = walkMs(dist, agent.speed);
    const cfg = { duration: reduce ? 0 : walk, easing: travelEasing };
    tx.value = withTiming(x, cfg);
    ty.value = withTiming(y, cfg);
  }, [x, y, reduce, tx, ty, agent.speed]);

  useEffect(() => {
    if (agent.searching && !reduce) {
      pulse.value = 0;
      pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    } else {
      pulse.value = withTiming(0, { duration: duration.fast });
    }
  }, [agent.searching, reduce, pulse]);

  const moveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value - AGENT.width / 2 }, { translateY: ty.value - AGENT.height }],
  }));
  const bobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -bob.value * (active ? 5 : 3) }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: agent.searching ? (reduce ? 0.5 : 0.9 * (1 - pulse.value)) : 0,
    transform: [{ scale: 0.6 + pulse.value * 1.1 }],
  }));

  return (
    <Animated.View style={[styles.agent, moveStyle]} pointerEvents="none">
      <Animated.View style={[styles.ring, { borderColor: agent.color }, ringStyle]} />
      <Animated.View style={[bobStyle, dim && { opacity: DIM_OPACITY }]}>
        <Avatar color={agent.color} name={agent.name} chips={agent.chips} size="sm" variant="full" active={active} />
      </Animated.View>
      {bubble !== undefined && (
        <SpeechBubble key={bubble.text} {...bubble} x={x} y={y} />
      )}
    </Animated.View>
  );
}

function Pin({ pin, x, y }: { pin: MapPin; x: number; y: number }) {
  const styles = useStyles(createStyles);
  return (
    <Animated.View
      entering={ZoomIn.duration(duration.slow)}
      exiting={FadeOut.duration(duration.normal)}
      style={[styles.pin, { left: x - PIN_W / 2, top: y - PIN_H }]}
      accessible={pin.name !== undefined}
      accessibilityLabel={pin.name}
    >
      <Svg width={PIN_W} height={PIN_H} viewBox="0 0 24 32">
        <Path
          d="M12 31 C7 24 2 19 2 12 A10 10 0 1 1 22 12 C22 19 17 24 12 31 Z"
          fill={pin.color}
          stroke={PIN_STROKE}
          strokeWidth={1.6}
        />
      </Svg>
      <View style={styles.pinHead}>
        {pin.label !== undefined && pin.label !== "" ? (
          <AppText variant="micro" color={PIN_INK}>
            {pin.label}
          </AppText>
        ) : (
          <View style={styles.pinDot} />
        )}
      </View>
    </Animated.View>
  );
}

function FlagPin({ pin, x, y, palette }: { pin: MapPin; x: number; y: number; palette: (typeof mapArtPalettes)["light"] }) {
  return (
    <Animated.View
      entering={ZoomIn.duration(duration.slow)}
      exiting={FadeOut.duration(duration.normal)}
      style={{ position: "absolute", width: FLAG_W, height: FLAG_H, left: x - FLAG_FOOT.x, top: y - FLAG_FOOT.y, transformOrigin: "9% 95%" }}
      accessible={pin.name !== undefined}
      accessibilityLabel={pin.name}
    >
      <Flag color={pin.color} label={pin.label} palette={palette} />
    </Animated.View>
  );
}

/** 조용한 지도의 장소 스티커: 둥근 사각 스티커 둘레 테두리 + 오른쪽 위 순서 번호 */
const STICKER = 32;
const STICKER_RING = 2.5;
const STICKER_BOX = STICKER + STICKER_RING * 2;
/** 스티커끼리 이만큼은 떨어지게 벌린다(번호 꼬리표가 옆 스티커에 닿지 않게 조금 더) */
const STICKER_GAP = STICKER_BOX + 6;
const TAG = 18;

function StickerPin({ pin, x, y, palette }: { pin: MapPin; x: number; y: number; palette: (typeof mapArtPalettes)["light"] }) {
  return (
    <Animated.View
      entering={ZoomIn.duration(duration.slow)}
      exiting={FadeOut.duration(duration.normal)}
      style={[pinStyles.sticker, { left: x - STICKER_BOX / 2, top: y - STICKER_BOX / 2, backgroundColor: palette.calmCasing }]}
      accessible={pin.name !== undefined}
      accessibilityLabel={pin.name}
    >
      <PlaceSticker kind={pin.kind ?? "pin"} size={STICKER} />
      {pin.label !== undefined && (
        <View style={[pinStyles.tag, { borderColor: palette.calmCasing }]}>
          <AppText variant="caption" tone="onColor" maxFontSizeMultiplier={1} style={pinStyles.tagText}>
            {pin.label}
          </AppText>
        </View>
      )}
    </Animated.View>
  );
}

const pinStyles = StyleSheet.create({
  sticker: {
    position: "absolute",
    width: STICKER_BOX,
    height: STICKER_BOX,
    padding: STICKER_RING,
    borderRadius: STICKER * 0.32 + STICKER_RING,
  },
  tag: {
    position: "absolute",
    right: -TAG / 2 + 2,
    top: -TAG / 2 + 2,
    minWidth: TAG,
    height: TAG,
    borderRadius: TAG / 2,
    borderWidth: 1.5,
    backgroundColor: PIN_INK,
    alignItems: "center",
    justifyContent: "center",
  },
  tagText: { fontSize: 10, lineHeight: 12, fontWeight: "800" },
});

/**
 * B2 회의 진행 지도. 단순 SVG 바탕 위에 핀(후보)·아바타(AI)·말풍선을 겹친다.
 * 위치는 위도·경도로 받고 bounds 안에서 화면 좌표로 바꾼다.
 */
export default function MeetingMap({
  bounds,
  pins = [],
  agents = [],
  routes = [],
  bubble = null,
  land = [],
  art,
  artView = "full",
  height = 300,
  viewHeight,
  calm = false,
  accessibilityLabel = "회의 지도",
}: MeetingMapProps) {
  const { colors, scheme } = useTheme();
  const palette = mapArtPalettes[scheme];
  const styles = useStyles(createStyles);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // 그림 지도: 그림 좌표로 바꾼 뒤, 보여 줄 사각형(viewport)으로 화면 좌표를 만든다.
  // 'full'(회의 진행)은 그림 전체를 한 판으로 깔고 "카메라"만 부드럽게 옮긴다(위아래·좌우). 그래서 핀·캐릭터가 바뀌어도 지도가 튀지 않는다.
  // 'fit'(일정 위쪽 작은 지도)은 점들이 들어오게 확대해 그대로 보여 준다.
  const camera = art === "busan" && artView === "full";
  const camTarget = useRef<ArtPoint | null>(null);
  const artScale = width > 0 ? width / VIEW_W : 1;
  const artH = Math.max(ART_H, height / artScale);
  const agentPoints = useMemo(() => (art !== "busan" ? [] : agents.map((a) => projectGeo(a))), [art, agents]);
  const artPoints = useMemo(
    () =>
      art !== "busan"
        ? []
        : [
            ...pins.map((p) => projectGeo(p)),
            ...agents.map((a) => projectGeo(a)),
            ...routes.flatMap((r) => r.points.map((p) => projectGeo(p))),
          ],
    [art, pins, agents, routes],
  );
  let cam: ArtPoint = { x: 0, y: 0 };
  if (camera && width > 0) {
    cam = cameraXY(camTarget.current, artPoints, width, viewHeight ?? height, agentPoints);
    camTarget.current = cam;
  }
  const camX = cam.x;
  const camY = cam.y;
  const viewport = useMemo<ArtViewport | null>(() => {
    if (art !== "busan" || width <= 0) return null;
    if (camera) return { x: 0, y: 0, w: ART_W, h: artH, scale: artScale };
    return computeArtViewport(artPoints, width, viewHeight ?? height, artView);
  }, [art, camera, artView, width, height, viewHeight, artH, artScale, artPoints]);

  const camValue = useRef(new RNAnimated.ValueXY({ x: 0, y: 0 })).current;
  const camShown = useRef(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!camera || width <= 0) return;
    const to = { x: -camX * artScale, y: -camY * artScale };
    if (!camShown.current || reduceMotion) {
      camShown.current = true;
      camValue.setValue(to);
      return;
    }
    const run = RNAnimated.timing(camValue, {
      toValue: to,
      duration: CAMERA_MS,
      easing: RNEasing.inOut(RNEasing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [camera, camX, camY, artScale, width, camValue, reduceMotion]);

  const at = (p: LatLng) => {
    if (viewport) {
      const q = projectGeo(p);
      return { x: (q.x - viewport.x) * viewport.scale, y: (q.y - viewport.y) * viewport.scale };
    }
    return project(p, bounds, width, height);
  };
  // 같은 곳에 모인 캐릭터는 겹치지 않게 좌우로 벌려 세운다.
  const fanOut = new Map<string, number>();
  const placed: { x: number; y: number }[] = [];
  for (const a of agents) {
    const p = at(a);
    const k = placed.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < FAN_RADIUS).length;
    placed.push(p);
    fanOut.set(a.id, k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * FAN_STEP);
  }
  const agentAt = (a: MapAgent) => {
    const p = at(a);
    const dx = fanOut.get(a.id) ?? 0;
    return viewport
      ? { x: p.x + ART_AGENT_DX + dx, y: p.y }
      : { x: p.x + AGENT_OFFSET.x + dx, y: p.y + AGENT_OFFSET.y };
  };

  // 조용한 지도: 가까운 장소 스티커는 서로 닿지 않게 벌리고, 길은 벌린 자리를 순서대로 잇는다.
  const calmPins = calm && viewport ? spreadPoints(pins.map((pin) => at(pin)), STICKER_GAP) : [];

  // viewHeight가 따로 있으면 그림 위치·배율은 그 기준으로 두고, 아래쪽은 같은 배율로 이어서 더 보여 준다(시트가 접히면 드러나는 부분).
  const viewBoxHeight = viewport ? (camera ? artH : viewHeight !== undefined ? height / viewport.scale : viewport.h) : 0;
  // 카메라 모드의 그림은 그림 전체 크기로 깔고 컨테이너를 옮긴다. 그 밖에는 보이는 영역만큼만 그린다.
  const svgH = camera ? artH * artScale : height;
  const svgW = camera ? ART_W * artScale : width;
  const gridStep = 40;

  return (
    <View style={[styles.map, { height }]} onLayout={onLayout} accessibilityLabel={accessibilityLabel} accessibilityRole="image">
      {width > 0 && (
        <Layers camera={camera} width={svgW} height={svgH} offset={camValue}>
          {viewport && (
            <Svg
              width={svgW}
              height={svgH}
              viewBox={`${viewport.x} ${viewport.y} ${viewport.w} ${viewBoxHeight}`}
              style={StyleSheet.absoluteFill}
            >
              <RegionArt palette={palette} calm={calm} />
            </Svg>
          )}
          {viewport && routes.length > 0 && (
            <Svg width={svgW} height={svgH} style={StyleSheet.absoluteFill} pointerEvents="none">
              {routes.map((r, i) => {
                const d = smoothPath(calmPins.length > 1 ? calmPins : r.points.map(at));
                if (d === "") return null;
                return (
                  <G key={`route${i}`}>
                    {palette.night && (
                      <Path d={d} stroke={palette.trail} strokeWidth={14} strokeLinecap="round" fill="none" opacity={0.18} />
                    )}
                    <G transform="translate(0 2)">
                      <Path d={d} stroke={palette.trailUnder} strokeWidth={7} strokeDasharray="0.1 12" strokeLinecap="round" fill="none" />
                    </G>
                    <Path d={d} stroke={palette.trail} strokeWidth={7} strokeDasharray="0.1 12" strokeLinecap="round" fill="none" />
                  </G>
                );
              })}
            </Svg>
          )}
          {!viewport && (
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Rect width={width} height={height} fill={colors.mapSea} />
            {Array.from({ length: Math.ceil(width / gridStep) }, (_, i) => (
              <Line key={`v${i}`} x1={(i + 0.5) * gridStep} y1={0} x2={(i + 0.5) * gridStep} y2={height} stroke={colors.mapGrid} strokeWidth={1} />
            ))}
            {Array.from({ length: Math.ceil(height / gridStep) }, (_, i) => (
              <Line key={`h${i}`} x1={0} y1={(i + 0.5) * gridStep} x2={width} y2={(i + 0.5) * gridStep} stroke={colors.mapGrid} strokeWidth={1} />
            ))}
            {land.map((shape, i) => (
              <Polygon
                key={`land${i}`}
                points={shape.map((p) => {
                  const q = at(p);
                  return `${q.x},${q.y}`;
                }).join(" ")}
                fill={colors.mapLand}
                stroke={colors.mapLandEdge}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            ))}
            {routes.map((r, i) => (
              <Polyline
                key={`route${i}`}
                points={r.points.map((p) => {
                  const q = at(p);
                  return `${q.x},${q.y - PIN_H * 0.45}`;
                }).join(" ")}
                fill="none"
                stroke={r.color}
                strokeWidth={2.5}
                strokeDasharray="6 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
          )}

          {pins.map((pin, i) => {
            const p = calmPins[i] ?? at(pin);
            if (calm && viewport) return <StickerPin key={pin.id} pin={pin} x={p.x} y={p.y} palette={palette} />;
            return viewport ? (
              <FlagPin key={pin.id} pin={pin} x={p.x} y={p.y} palette={palette} />
            ) : (
              <Pin key={pin.id} pin={pin} x={p.x} y={p.y} />
            );
          })}

          {/* 말하는 AI를 맨 위에 그리도록 마지막으로 보낸다. */}
          {[...agents]
            .sort((a, b) => Number(a.id === bubble?.agentId) - Number(b.id === bubble?.agentId))
            .map((a) => {
              const p = agentAt(a);
              return (
                <AgentMarker
                  key={a.id}
                  agent={a}
                  x={p.x}
                  y={p.y}
                  active={a.id === bubble?.agentId}
                  dim={bubble != null && a.id !== bubble.agentId}
                  bubble={
                    bubble != null && a.id === bubble.agentId
                      ? {
                          speaker: `${a.name} AI`,
                          text: bubble.text,
                          mapWidth: width,
                          leftInset: camera ? camX * artScale : 0,
                          topInset: camera ? camY * artScale : 0,
                        }
                      : undefined
                  }
                />
              );
            })}

        </Layers>
      )}
      {viewport && (
        <View style={[styles.credit, { top: (viewHeight ?? height) - CREDIT_H - spacing.xs }]} pointerEvents="none">
          <AppText variant="micro" color={colors.onBubble}>
            {MAP_CREDIT}
          </AppText>
        </View>
      )}
    </View>
  );
}

/** 카메라 모드면 그림·핀·캐릭터를 한 판으로 묶어 같이 움직이고, 아니면 그냥 펼쳐 놓는다. */
function Layers({
  camera,
  width,
  height,
  offset,
  children,
}: {
  camera: boolean;
  width: number;
  height: number;
  offset: RNAnimated.ValueXY;
  children: React.ReactNode;
}) {
  if (!camera) return <>{children}</>;
  return (
    <RNAnimated.View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, top: 0, width, height, transform: [{ translateX: offset.x }, { translateY: offset.y }] }}
    >
      {children}
    </RNAnimated.View>
  );
}

const BUBBLE_MAX = 220;

// 지도 그림의 땅 모양은 통계청 자료라 출처를 화면에 적는다(공공누리 제1유형).
const MAP_CREDIT = "지도 출처: 통계청 SGIS";
const CREDIT_H = 18;

/**
 * 말하는 캐릭터 머리 위의 말풍선. 캐릭터(AgentMarker) 안에 들어 있어서 캐릭터가 걸어가는 동안에도 같이 움직인다.
 * x, y는 캐릭터가 서게 될 발 위치(지도 좌표). 화면 가장자리를 넘지 않게 옆으로 밀고, 위쪽이 모자라면 발 아래로 내린다.
 */
function SpeechBubble({
  speaker,
  text,
  x,
  y,
  mapWidth,
  leftInset,
  topInset,
}: AgentBubble & { x: number; y: number }) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { w, h } = size;
  const below = y - topInset - AGENT_ACTIVE_H - h - 10 < spacing.sm;
  // 지도 좌표의 말풍선 왼쪽 끝(가장자리 안쪽으로 제한)을 캐릭터 상자 기준으로 바꾼다.
  const left = Math.min(Math.max(x - w / 2, leftInset + spacing.sm), leftInset + mapWidth - w - spacing.sm);
  const relLeft = left - (x - AGENT.width / 2);
  const relTop = below ? AGENT.height + 10 : AGENT.height - AGENT_ACTIVE_H - h - 8;
  const tailLeft = Math.min(Math.max(x - left - 5, radius.md), Math.max(w - radius.md - 10, radius.md));

  return (
    // 나타나는 애니메이션(Animated.View)과 투명도(opacity)를 한 요소에 같이 두면 서로 덮어쓰므로 겹으로 나눈다.
    <Animated.View
      entering={FadeIn.duration(duration.normal)}
      exiting={FadeOut.duration(duration.fast)}
      style={{ position: "absolute", left: relLeft, top: relTop, width: BUBBLE_MAX, alignItems: "flex-start" }}
      accessibilityLiveRegion="polite"
      pointerEvents="none"
    >
      <View
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={[styles.bubble, { opacity: w === 0 ? 0 : 1 }]}
      >
        <View style={[styles.tail, below ? { top: -5 } : { bottom: -5 }, { left: tailLeft }]} />
        <AppText variant="smallStrong" color={colors.onBubble} style={styles.bubbleText}>
          {speaker}
        </AppText>
        <AppText variant="caption" color={colors.onBubble} style={styles.bubbleText}>
          {text}
        </AppText>
      </View>
    </Animated.View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  map: {
    overflow: "hidden",
    backgroundColor: t.colors.mapSea,
  },
  pin: {
    position: "absolute",
    width: PIN_W,
    height: PIN_H,
    transformOrigin: "50% 100%",
  },
  pinHead: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: PIN_STROKE,
    alignItems: "center",
    justifyContent: "center",
  },
  pinDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: PIN_INK,
  },
  agent: {
    position: "absolute",
    left: 0,
    top: 0,
    width: AGENT.width,
    height: AGENT.height,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  // 조사 중이면 발밑 바닥에 퍼지는 타원
  ring: {
    position: "absolute",
    bottom: -AGENT.width * 0.2,
    width: AGENT.width * 1.4,
    height: AGENT.width * 0.55,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  credit: {
    position: "absolute",
    left: spacing.xs,
    height: CREDIT_H,
    paddingHorizontal: spacing.xs,
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: t.colors.bubble,
    opacity: 0.75,
  },
  bubble: {
    maxWidth: BUBBLE_MAX,
    backgroundColor: t.colors.bubble,
    borderRadius: radius.md,
    paddingVertical: spacing.xs + spacing.xxs,
    paddingHorizontal: spacing.sm + spacing.xxs,
    boxShadow: t.elevation.float,
  },
  bubbleText: {
    fontWeight: "500",
  },
  tail: {
    position: "absolute",
    width: 10,
    height: 10,
    backgroundColor: t.colors.bubble,
    transform: [{ rotate: "45deg" }],
  },
});
