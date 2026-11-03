import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ZoomIn,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

import { duration, easing, lightColors, mapArtPalettes, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { fullAvatarSize, type AvatarChip } from "./Avatar.tsx";
import PlaceSticker, { type PlaceKind } from "./PlaceSticker.tsx";
import Flag, { FLAG_FOOT, FLAG_H, FLAG_W } from "./map/Flag.tsx";
import { spreadPoints } from "./map/spreadPoints.ts";
import { walkMs } from "./map/walk.ts";
import { ART_H, ART_W, VIEW_W, cameraXY, computeArtViewport, pathMidArrows, projectGeo, smoothPath, type ArtPoint } from "./map/regionArt.ts";
import {
  TILE_CREDIT,
  TILE_HEADERS,
  TILE_URL,
  cameraOn,
  clampCamera,
  destinationRect,
  scaleLimits,
  tilesFor,
  viewRect,
  zoomAround,
  zoomForScale,
  type MapCamera,
} from "./map/tiles.ts";

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
  /** 'busan'이면 격자 대신 오픈스트리트맵 지도(부산 둘레)와 깃발 핀을 쓰고, 끌기·확대가 된다. 이때 bounds·land는 무시한다. */
  art?: "busan";
  /** 그림 지도에서 'full'은 한 화면 폭으로 보여 주며 카메라가 핀을 따라 옮겨 다니고(회의 진행), 'fit'은 핀·경로가 들어오게 확대한다(일정 위쪽 작은 지도) */
  artView?: "full" | "fit";
  height?: number;
  /** 지도 그림을 어디에 맞출지 계산할 때 쓰는 높이. 생략하면 height. 아래를 시트가 가릴 때 보이는 부분 높이를 준다. */
  viewHeight?: number;
  /** 일정 지도처럼 조용하게: 핀은 장소 스티커로 서로 겹치지 않게 벌리고, 길은 그 스티커를 순서대로 잇는다. 그림 지도(art)에서만 쓴다. */
  calm?: boolean;
  /** 이 장소로 확대해 보여 준다(일정에서 장소를 눌렀을 때). 같은 위치의 스티커는 크게. */
  focus?: LatLng | null;
  /** 사람이 지도를 끌거나 확대했을 때(또는 focus가 있을 때) 지도 위에 띄우는 되돌리기 버튼 글자. 없으면 버튼이 없다. */
  followLabel?: string;
  /** 되돌리기 버튼을 눌렀을 때(자동 카메라는 지도가 다시 켠다. focus를 지우는 건 부르는 쪽) */
  onFollow?: () => void;
  /** 바뀌면 사람이 옮긴 것을 잊고 자동 카메라로 돌아간다(회의 단계가 바뀔 때) */
  followKey?: unknown;
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

/**
 * 지도 위 한 점(그림 좌표 x, y)에 붙는 표시. 지도를 확대·축소해도 표시는 같은 크기로 보이게 배율의 반대로 줄인다.
 * 크기 0인 상자를 그 점에 두고 줄이므로, 안의 내용은 그 점을 기준으로 화면 px 그대로 놓으면 된다.
 */
function Anchor({ x, y, scale, children }: { x: number; y: number; scale: SharedValue<number>; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x }, { translateY: y }, { scale: 1 / scale.value }] }));
  return (
    <Animated.View style={[anchorStyles.anchor, style]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

const anchorStyles = StyleSheet.create({
  anchor: { position: "absolute", left: 0, top: 0, width: 0, height: 0, overflow: "visible" },
});

/** 말하는 캐릭터에게 붙는 말풍선 내용. 캐릭터 안에 들어가서 걷는 동안에도 머리 위에 붙어 다닌다. */
type AgentBubble = { speaker: string; text: string; mapWidth: number; leftInset: number; topInset: number };

/**
 * 지도 위 캐릭터. x, y는 발 위치(그림 좌표). 걸어서 옮겨 가고, 지도 배율과 상관없이 같은 크기로 보인다.
 * dx는 같은 곳에 모인 캐릭터를 벌리는 화면 px, screen은 지금 화면에서의 발 위치(말풍선이 가장자리를 넘지 않게 쓴다).
 */
function AgentMarker({
  agent,
  x,
  y,
  dx,
  pxScale,
  scale,
  screen,
  active,
  dim = false,
  bubble,
}: {
  agent: MapAgent;
  x: number;
  y: number;
  dx: number;
  pxScale: number;
  scale: SharedValue<number>;
  screen: { x: number; y: number };
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
    // 걷는 시간은 화면에서 걷는 거리로 정한다.
    const dist = Math.hypot(x - last.current.x, y - last.current.y) * pxScale;
    last.current = { x, y };
    const walk = walkMs(dist, agent.speed);
    const cfg = { duration: reduce ? 0 : walk, easing: travelEasing };
    tx.value = withTiming(x, cfg);
    ty.value = withTiming(y, cfg);
  }, [x, y, reduce, tx, ty, agent.speed, pxScale]);

  useEffect(() => {
    if (agent.searching && !reduce) {
      pulse.value = 0;
      pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    } else {
      pulse.value = withTiming(0, { duration: duration.fast });
    }
  }, [agent.searching, reduce, pulse]);

  const moveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 / scale.value }],
  }));
  const bobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -bob.value * (active ? 5 : 3) }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: agent.searching ? (reduce ? 0.5 : 0.9 * (1 - pulse.value)) : 0,
    transform: [{ scale: 0.6 + pulse.value * 1.1 }],
  }));

  return (
    <Animated.View style={[anchorStyles.anchor, moveStyle]} pointerEvents="none">
      <View style={[styles.agent, { left: dx - AGENT.width / 2, top: -AGENT.height }]}>
        <Animated.View style={[styles.ring, { borderColor: agent.color }, ringStyle]} />
        <Animated.View style={[bobStyle, dim && { opacity: DIM_OPACITY }]}>
          <Avatar color={agent.color} name={agent.name} chips={agent.chips} size="sm" variant="full" active={active} />
        </Animated.View>
        {bubble !== undefined && <SpeechBubble key={bubble.text} {...bubble} x={screen.x + dx} y={screen.y} />}
      </View>
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

/** 회의 지도의 깃발 핀. (0, 0)이 깃대 발(Anchor 안에서 화면 px로 놓는다). */
function FlagPin({ pin, palette }: { pin: MapPin; palette: (typeof mapArtPalettes)["light"] }) {
  return (
    <Animated.View
      entering={ZoomIn.duration(duration.slow)}
      exiting={FadeOut.duration(duration.normal)}
      style={{ position: "absolute", width: FLAG_W, height: FLAG_H, left: -FLAG_FOOT.x, top: -FLAG_FOOT.y, transformOrigin: "9% 95%" }}
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

/** (0, 0)이 스티커 가운데(Anchor 안에서 화면 px로 놓는다). 고른 장소면 조금 크게. */
function StickerPin({ pin, palette, selected = false }: { pin: MapPin; palette: (typeof mapArtPalettes)["light"]; selected?: boolean }) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={ZoomIn.duration(duration.slow)}
      exiting={FadeOut.duration(duration.normal)}
      style={[
        pinStyles.sticker,
        { left: -STICKER_BOX / 2, top: -STICKER_BOX / 2, backgroundColor: selected ? colors.accent : palette.calmCasing },
        selected && { transform: [{ scale: 1.3 }] },
      ]}
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

/** 지도 판(world)이 그림 둘레로 더 가진 폭(그림 px). 끌 수 있는 범위 끝까지 가도 타일이 이 안에 든다. */
const WORLD_PAD = 4000;
/** 확대한 장소로 갈 때의 배율(골목이 보이는 정도) */
const FOCUS_SCALE = 10;
// 오픈스트리트맵 타일 위에 앱 바탕색을 반투명하게 덮어 색·글자를 눌러 준다(11/2 시안: 밝게 45%, 어둡게 60%).
const VEIL = { light: "rgba(251, 248, 243, 0.45)", dark: "rgba(21, 22, 29, 0.6)" } as const;
/** 경로 방향 꺾쇠(›) 모양(화면 px)과, 꺾쇠를 넣을 가장 짧은 구간(화면 px) */
const CHEVRON = "M-4 -4.5L2 0L-4 4.5";
const ARROW_MIN_LEG = 48;
/** 장소 표시와 이만큼(화면 px) 가까우면 꺾쇠가 가려진 것으로 본다 */
const ARROW_PIN_CLEAR = 28;

/**
 * B2 회의 진행 지도·일정 지도. art가 있으면 오픈스트리트맵 타일 위에 핀(후보)·캐릭터(AI)·말풍선·길을 겹치고,
 * 손가락으로 끌고 두 손가락으로 확대·축소할 수 있다(끌 수 있는 범위는 tiles.ts clampCamera).
 * art가 없으면 bounds 안의 단순 격자 지도.
 */
export default function MeetingMap(props: MeetingMapProps) {
  return props.art === undefined ? <GridMap {...props} /> : <TileMap {...props} />;
}

function TileMap({
  pins = [],
  agents = [],
  routes = [],
  bubble = null,
  artView = "full",
  height = 300,
  viewHeight,
  calm = false,
  focus = null,
  followLabel,
  onFollow,
  followKey,
  accessibilityLabel = "회의 지도",
}: MeetingMapProps) {
  const { colors, scheme } = useTheme();
  const palette = mapArtPalettes[scheme];
  const styles = useStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const viewH = viewHeight ?? height;

  // 'full'(회의 진행)은 화면 폭에 맞춘 배율로 카메라가 말하는 캐릭터·핀을 따라 옮겨 다니고,
  // 'fit'(일정 위쪽 작은 지도)은 점들이 들어오게 확대한다. 일정에서 장소를 고르면(focus) 그 장소로 확대한다.
  const follow = artView === "full";
  const camTarget = useRef<ArtPoint | null>(null);
  const artScale = width > 0 ? width / VIEW_W : 1;
  const agentPoints = useMemo(() => agents.map((a) => projectGeo(a)), [agents]);
  const artPoints = useMemo(
    () => [...pins.map((p) => projectGeo(p)), ...agents.map((a) => projectGeo(a)), ...routes.flatMap((r) => r.points.map((p) => projectGeo(p)))],
    [pins, agents, routes],
  );
  // 말하는 캐릭터는 말풍선까지 늘 화면 안에 둔다(다 못 담을 때 가운데만 잡으면 가장자리 캐릭터가 빠진다).
  const speaker = useMemo(() => {
    const a = bubble != null ? agents.find((x) => x.id === bubble.agentId) : undefined;
    return a === undefined ? null : projectGeo(a);
  }, [agents, bubble]);

  let target: MapCamera | null = null;
  if (width > 0) {
    if (focus !== null) {
      target = cameraOn(projectGeo(focus), FOCUS_SCALE, width, viewH);
    } else if (follow) {
      const cam = cameraXY(camTarget.current, artPoints, width, viewH, agentPoints, speaker);
      camTarget.current = cam;
      target = { x: cam.x, y: cam.y, scale: artScale };
    } else {
      const v = computeArtViewport(artPoints, width, viewH, "fit");
      target = { x: v.x, y: v.y, scale: v.scale };
    }
  }

  // 카메라: 화면 왼쪽 위의 그림 좌표와 배율. 움직이는 값(camX·camY·camS)과, 멈춘 뒤의 값(settled: 타일 고르기·말풍선 자리에 씀)을 둔다.
  const camX = useSharedValue(0);
  const camY = useSharedValue(0);
  const camS = useSharedValue(1);
  const [settled, setSettled] = useState<MapCamera>({ x: 0, y: 0, scale: 1 });
  // 사람이 끌거나 확대했으면 자동 카메라를 멈춘다. "따라보기"(또는 followKey가 바뀜)로 다시 켠다.
  const [userMoved, setUserMoved] = useState(false);
  useEffect(() => setUserMoved(false), [followKey, focus?.lat, focus?.lng]);

  const shown = useRef(false);
  const camStartedAt = useRef(0);
  const tx = target?.x ?? 0;
  const ty = target?.y ?? 0;
  const ts = target?.scale ?? 1;
  useEffect(() => {
    if (target === null || userMoved) return;
    const to = clampCamera({ x: tx, y: ty, scale: ts }, width, viewH);
    const go = (ms: number) => {
      const cfg = { duration: ms, easing: Easing.inOut(Easing.cubic) };
      camX.value = withTiming(to.x, cfg);
      camY.value = withTiming(to.y, cfg);
      camS.value = withTiming(to.scale, cfg);
      setSettled(to);
    };
    if (!shown.current || reduceMotion) {
      shown.current = true;
      camX.value = to.x;
      camY.value = to.y;
      camS.value = to.scale;
      setSettled(to);
      return;
    }
    if (!follow) {
      go(CAMERA_MS);
      return;
    }
    // 앞 이동을 끝까지 마친 뒤 그때의 가장 새 목표로 간다. 회의 초반처럼 목표가 연달아 바뀔 때
    // 이동 도중에 꺾으면 지도가 급하게 흔들려 보인다(기다리는 사이 새 목표가 오면 이 예약은 지우고 새로 잡는다).
    const wait = Math.max(0, camStartedAt.current + CAMERA_MS - Date.now());
    const timer = setTimeout(() => {
      camStartedAt.current = Date.now();
      go(CAMERA_MS);
    }, wait);
    return () => clearTimeout(timer);
  }, [tx, ty, ts, width, viewH, userMoved, follow, reduceMotion, camX, camY, camS, target === null]);

  // 손가락: 끌기(한 손가락)·확대(두 손가락). 바뀐 만큼씩 더해 두 동작이 같이 돼도 엉키지 않는다.
  const limits = useMemo(() => scaleLimits(width || VIEW_W, viewH), [width, viewH]);
  const dest = useMemo(() => destinationRect(), []);
  // 손가락 동작은 화면 쪽 스레드(worklet)에서 바로 카메라 값을 바꾼다(앱 본체가 바빠도 끊기지 않게).
  // 끌기·확대는 바뀐 만큼씩 더해서 두 동작이 같이 돼도 엉키지 않는다. 손을 떼면 그 자리로 타일·말풍선 자리를 다시 정한다.
  const markMoved = () => setUserMoved(true);
  const settle = (x: number, y: number, scale: number) => setSettled({ x, y, scale });
  const viewW = width;
  const minS = limits.min;
  const maxS = limits.max;
  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onStart(() => {
      cancelAnimation(camX);
      cancelAnimation(camY);
      cancelAnimation(camS);
      runOnJS(markMoved)();
    })
    .onChange((e) => {
      const k = clampCamera({ x: camX.value - e.changeX / camS.value, y: camY.value - e.changeY / camS.value, scale: camS.value }, viewW, viewH, dest);
      camX.value = k.x;
      camY.value = k.y;
    })
    .onEnd(() => {
      runOnJS(settle)(camX.value, camY.value, camS.value);
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      cancelAnimation(camX);
      cancelAnimation(camY);
      cancelAnimation(camS);
      runOnJS(markMoved)();
    })
    .onChange((e) => {
      const next = Math.min(Math.max(camS.value * e.scaleChange, minS), maxS);
      if (!Number.isFinite(next) || next <= 0) return;
      const z = zoomAround({ x: camX.value, y: camY.value, scale: camS.value }, next, e.focalX, e.focalY);
      const k = clampCamera(z, viewW, viewH, dest);
      camX.value = k.x;
      camY.value = k.y;
      camS.value = k.scale;
    })
    .onEnd(() => {
      runOnJS(settle)(camX.value, camY.value, camS.value);
    });
  const gesture = Gesture.Simultaneous(pinch, pan);

  // 지도 판은 그림 좌표 둘레로 넉넉히(WORLD_PAD) 큰 상자다. 안의 것은 그림 좌표 + WORLD_PAD 자리에 놓고, 판 전체를 옮기고 키운다.
  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(camX.value + WORLD_PAD) * camS.value }, { translateY: -(camY.value + WORLD_PAD) * camS.value }, { scale: camS.value }],
  }));

  // 타일: 지금 보이는 곳 둘레만 그린다. 굵은 타일(가장 작게 줄였을 때의 단계)을 보이는 곳보다 넓게 깔고, 그 위에 자세한 타일.
  const pixelRatio = PixelRatio.get();
  const baseZ = zoomForScale(limits.min, pixelRatio);
  const detailZ = zoomForScale(settled.scale, pixelRatio);
  const baseTiles = useMemo(() => {
    if (width <= 0) return [];
    const v = viewRect(settled, width, height);
    const mx = (v.x1 - v.x0) / 4;
    const my = (v.y1 - v.y0) / 4;
    return tilesFor({ x0: v.x0 - mx, y0: v.y0 - my, x1: v.x1 + mx, y1: v.y1 + my }, baseZ, 0);
  }, [settled, width, height, baseZ]);
  const detailTiles = useMemo(
    () => (width > 0 && detailZ > baseZ ? tilesFor(viewRect(settled, width, height), detailZ, 0) : []),
    [settled, width, height, detailZ, baseZ],
  );

  // 화면 px 간격(캐릭터 벌리기·스티커 벌리기)을 그림 좌표로 바꿀 때 쓰는 배율
  const px = settled.scale;
  const toScreen = (p: ArtPoint) => ({ x: (p.x - settled.x) * px, y: (p.y - settled.y) * px });
  // 같은 곳에 모인 캐릭터는 겹치지 않게 좌우로 벌려 세운다(화면 px).
  const fanOut = new Map<string, number>();
  const placed: ArtPoint[] = [];
  for (const a of agents) {
    const p = projectGeo(a);
    const k = placed.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) * px < FAN_RADIUS).length;
    placed.push(p);
    fanOut.set(a.id, k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * FAN_STEP);
  }

  // 조용한 지도: 가까운 장소 스티커는 화면에서 서로 닿지 않게 벌리고(그림 좌표로 되돌림), 길은 벌린 자리를 순서대로 잇는다.
  const calmPins = calm
    ? spreadPoints(pins.map((pin) => toScreen(projectGeo(pin))), STICKER_GAP).map((q) => ({ x: settled.x + q.x / px, y: settled.y + q.y / px }))
    : [];
  const pinAt = (i: number) => calmPins[i] ?? projectGeo(pins[i]!);
  const calmAt = (p: LatLng, i: number) => {
    const same = (q: LatLng | undefined) => q !== undefined && q.lat === p.lat && q.lng === p.lng;
    const k = same(pins[i]) ? i : pins.findIndex(same);
    return calmPins[k] ?? projectGeo(p);
  };
  const focusIndex = focus === null ? -1 : pins.findIndex((p) => p.lat === focus.lat && p.lng === focus.lng);
  const showFollow = followLabel !== undefined && (userMoved || focus !== null);

  return (
    // 바깥 상자에서 지도를 잘라 낸다(타일이 아래 내용 뒤로 새지 않게). 손가락 동작은 앱 맨 바깥 GestureHandlerRootView가 받는다(_layout).
    <View
      style={[styles.map, { height, backgroundColor: palette.night ? "#20222B" : "#EFEAE0" }]}
      onLayout={onLayout}
    >
    <View style={styles.gestureRoot}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} accessible accessibilityLabel={accessibilityLabel} accessibilityRole="image">
          {width > 0 && (
            <>
              <Animated.View style={[styles.world, worldStyle]} pointerEvents="none">
                {[...baseTiles, ...detailTiles].map((t) => (
                  <Image
                    key={t.key}
                    source={{ uri: TILE_URL(t.z, t.x, t.y), headers: TILE_HEADERS }}
                    cachePolicy="memory-disk"
                    style={{ position: "absolute", left: t.left + WORLD_PAD, top: t.top + WORLD_PAD, width: t.width + 0.6 / px, height: t.height + 0.6 / px }}
                  />
                ))}
              </Animated.View>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.night ? VEIL.dark : VEIL.light }]} pointerEvents="none" />
              <Animated.View style={[styles.world, worldStyle]} pointerEvents="none">
                {routes.length > 0 && (
                  <Svg width={ART_W} height={ART_H} style={styles.routes}>
                    {routes.map((r, i) => {
                      const points = r.points.map(calm ? calmAt : (p: LatLng) => projectGeo(p));
                      const d = smoothPath(points);
                      if (d === "") return null;
                      // 차분한 얇은 선 + 테두리, 구간 가운데에 가는 방향 꺾쇠(화면에서 짧은 구간은 뺀다). 굵기는 화면 기준.
                      const clear = (p: ArtPoint) => pins.every((_, k) => Math.hypot(p.x - pinAt(k).x, p.y - pinAt(k).y) * px >= ARROW_PIN_CLEAR);
                      const arrows = pathMidArrows(points, clear).filter((a) => a.length * px >= ARROW_MIN_LEG);
                      return (
                        <G key={`route${i}`}>
                          <Path d={d} stroke={palette.trailUnder} strokeWidth={7 / px} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
                          <Path d={d} stroke={palette.trail} strokeWidth={2.5 / px} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          {arrows.map((a, k) => (
                            <G key={k} transform={`translate(${a.x} ${a.y}) rotate(${a.deg}) scale(${1 / px})`}>
                              <Path d={CHEVRON} stroke={palette.trailUnder} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                              <Path d={CHEVRON} stroke={palette.trail} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </G>
                          ))}
                        </G>
                      );
                    })}
                  </Svg>
                )}
                {pins.map((pin, i) => {
                  const p = pinAt(i);
                  return (
                    <Anchor key={pin.id} x={p.x + WORLD_PAD} y={p.y + WORLD_PAD} scale={camS}>
                      {calm ? <StickerPin pin={pin} palette={palette} selected={i === focusIndex} /> : <FlagPin pin={pin} palette={palette} />}
                    </Anchor>
                  );
                })}
                {/* 말하는 AI를 맨 위에 그리도록 마지막으로 보낸다. 캐릭터는 깃발 오른쪽 바닥에 선다. */}
                {[...agents]
                  .sort((a, b) => Number(a.id === bubble?.agentId) - Number(b.id === bubble?.agentId))
                  .map((a) => {
                    const p = projectGeo(a);
                    const dx = ART_AGENT_DX + (fanOut.get(a.id) ?? 0);
                    return (
                      <AgentMarker
                        key={a.id}
                        agent={a}
                        x={p.x + WORLD_PAD}
                        y={p.y + WORLD_PAD}
                        dx={dx}
                        pxScale={px}
                        scale={camS}
                        screen={toScreen(p)}
                        active={a.id === bubble?.agentId}
                        dim={bubble != null && a.id !== bubble.agentId}
                        bubble={
                          bubble != null && a.id === bubble.agentId
                            ? { speaker: `${a.name} AI`, text: bubble.text, mapWidth: width, leftInset: 0, topInset: 0 }
                            : undefined
                        }
                      />
                    );
                  })}
              </Animated.View>
            </>
          )}
        </View>
      </GestureDetector>
      {showFollow && (
        <Pressable
          onPress={() => {
            setUserMoved(false);
            onFollow?.();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.followChip, pressed && { opacity: 0.75 }]}
        >
          <AppText variant="smallStrong" color={colors.onAccent}>
            {followLabel}
          </AppText>
        </Pressable>
      )}
      <View style={[styles.credit, { top: viewH - CREDIT_H - spacing.xs }]} pointerEvents="none">
        <AppText variant="micro" color={colors.onBubble}>
          {TILE_CREDIT}
        </AppText>
      </View>
    </View>
    </View>
  );
}

/** art가 없을 때: bounds 안의 위도·경도를 화면에 펼친 단순 격자 지도(움직이지 않음). */
function GridMap({ bounds, pins = [], agents = [], routes = [], bubble = null, land = [], height = 300, accessibilityLabel = "회의 지도" }: MeetingMapProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const at = (p: LatLng) => project(p, bounds, width, height);
  const gridStep = 40;
  return (
    <View style={[styles.map, { height }]} onLayout={onLayout} accessibilityLabel={accessibilityLabel} accessibilityRole="image">
      {width > 0 && (
        <>
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
          {pins.map((pin) => {
            const p = at(pin);
            return <Pin key={pin.id} pin={pin} x={p.x} y={p.y} />;
          })}
          {agents.map((a) => {
            const p = at(a);
            return (
              <View key={a.id} style={{ position: "absolute", left: p.x + AGENT_OFFSET.x - AGENT.width / 2, top: p.y + AGENT_OFFSET.y - AGENT.height }} pointerEvents="none">
                <Avatar color={a.color} name={a.name} chips={a.chips} size="sm" variant="full" active={a.id === bubble?.agentId} />
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

const BUBBLE_MAX = 220;
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
  // 그림 좌표로 펼친 지도 판: 그림 둘레로 WORLD_PAD만큼 큰 상자를 왼쪽 위 기준으로 옮기고 키운다.
  // 안드로이드에서 상자 밖으로 넘쳐 그리면 작은 움직임에도 지도 전체를 다시 그려 느려지므로, 넘치지 않게 크게 잡는다.
  world: { position: "absolute", left: 0, top: 0, width: ART_W + WORLD_PAD * 2, height: ART_H + WORLD_PAD * 2, transformOrigin: "0 0", overflow: "hidden" },
  routes: { position: "absolute", left: WORLD_PAD, top: WORLD_PAD },
  gestureRoot: { flex: 1, overflow: "hidden" },
  followChip: {
    position: "absolute",
    alignSelf: "center",
    top: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: t.colors.accent,
    boxShadow: t.elevation.float,
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
