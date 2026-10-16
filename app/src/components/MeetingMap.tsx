import { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
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
import Svg, { Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

import { duration, easing, lightColors, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { fullAvatarSize, type AvatarChip } from "./Avatar.tsx";

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
};

export type MapAgent = LatLng & {
  id: string;
  name: string;
  color: string;
  chips?: AvatarChip[];
  /** 조사 중이면 발밑에 퍼지는 원 */
  searching?: boolean;
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
  height?: number;
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
const PIN_STROKE = lightColors.textOnColor;

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

const travelEasing = Easing.bezier(easing.travel[0], easing.travel[1], easing.travel[2], easing.travel[3]);

/** x, y는 캐릭터 발 위치(바닥 가운데). */
function AgentMarker({ agent, x, y, active }: { agent: MapAgent; x: number; y: number; active: boolean }) {
  const styles = useStyles(createStyles);
  const reduce = useReducedMotion();
  const tx = useSharedValue(x);
  const ty = useSharedValue(y);
  const pulse = useSharedValue(0);

  useEffect(() => {
    const cfg = { duration: reduce ? 0 : duration.travel, easing: travelEasing };
    tx.value = withTiming(x, cfg);
    ty.value = withTiming(y, cfg);
  }, [x, y, reduce, tx, ty]);

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
  const ringStyle = useAnimatedStyle(() => ({
    opacity: agent.searching ? (reduce ? 0.5 : 0.9 * (1 - pulse.value)) : 0,
    transform: [{ scale: 0.6 + pulse.value * 1.1 }],
  }));

  return (
    <Animated.View style={[styles.agent, moveStyle]} pointerEvents="none">
      <Animated.View style={[styles.ring, { borderColor: agent.color }, ringStyle]} />
      <Avatar color={agent.color} name={agent.name} chips={agent.chips} size="sm" variant="full" active={active} />
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
  height = 300,
  accessibilityLabel = "회의 지도",
}: MeetingMapProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const at = (p: LatLng) => project(p, bounds, width, height);
  const agentAt = (a: MapAgent) => {
    const p = at(a);
    return { x: p.x + AGENT_OFFSET.x, y: p.y + AGENT_OFFSET.y };
  };

  const gridStep = 40;
  const bubbleAgent = bubble ? agents.find((a) => a.id === bubble.agentId) : undefined;

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

          {/* 말하는 AI를 맨 위에 그리도록 마지막으로 보낸다. */}
          {[...agents]
            .sort((a, b) => Number(a.id === bubble?.agentId) - Number(b.id === bubble?.agentId))
            .map((a) => {
              const p = agentAt(a);
              return <AgentMarker key={a.id} agent={a} x={p.x} y={p.y} active={a.id === bubble?.agentId} />;
            })}

          {bubble && bubbleAgent && (
            <SpeechBubble key={`${bubble.agentId}:${bubble.text}`} text={bubble.text} anchor={agentAt(bubbleAgent)} mapWidth={width} />
          )}
        </>
      )}
    </View>
  );
}

const BUBBLE_MAX = 220;

/** anchor는 말하는 캐릭터의 발 위치. 말풍선은 커진 캐릭터 머리 위에 뜬다. */
function SpeechBubble({ text, anchor, mapWidth }: { text: string; anchor: { x: number; y: number }; mapWidth: number }) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // 위쪽 공간이 모자라면 캐릭터 발 아래에 띄운다.
  const below = anchor.y - AGENT_ACTIVE_H - size.h - 10 < spacing.sm;
  const left = Math.min(Math.max(anchor.x - size.w / 2, spacing.sm), mapWidth - size.w - spacing.sm);
  const top = below ? anchor.y + 10 : anchor.y - AGENT_ACTIVE_H - size.h - 8;
  const tailLeft = Math.min(Math.max(anchor.x - left - 5, radius.md), Math.max(size.w - radius.md - 10, radius.md));

  return (
    <Animated.View
      entering={FadeIn.duration(duration.normal)}
      exiting={FadeOut.duration(duration.fast)}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[styles.bubble, { left, top, opacity: size.w === 0 ? 0 : 1 }]}
      accessibilityLiveRegion="polite"
      pointerEvents="none"
    >
      <View style={[styles.tail, below ? { top: -5 } : { bottom: -5 }, { left: tailLeft }]} />
      <AppText variant="caption" color={colors.onBubble} style={styles.bubbleText}>
        {text}
      </AppText>
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
  bubble: {
    position: "absolute",
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
