import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";

import { memberColors, outline, pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import type { AvatarChip } from "./Avatar.tsx";
import AvatarArt from "./character/AvatarArt.tsx";

export type PartyHomeMember = {
  id: string;
  name: string;
  color: string;
  /** 성향 검사를 마쳐 캐릭터가 있으면 true. 아니면 그 사람 색 점선 빈자리("?")로 선다. */
  ready: boolean;
  me: boolean;
  /** 캐릭터 소품을 정할 성향 칩(없으면 소품 없이 선다) */
  chips: AvatarChip[];
};

export type PartyHomeStageProps = {
  title: string;
  /** 제목 아래 한 줄(예: "2/5 · 친구 준비") */
  subtitle: string;
  members: PartyHomeMember[];
  /** 이름표 아래 "✓ 준비"/"검사 전"을 보일지(회의가 시작되면 숨긴다) */
  showStatus: boolean;
  /** 초대할 수 있는 빈자리 수. 0이면 안 보인다. */
  seats: number;
  onInvite: () => void;
  bubble: { speakerId: string; text: string } | null;
  /** 합의안이 나왔을 때 무대 위 색종이 */
  confetti: boolean;
  onExit: () => void;
  onSettings: () => void;
  /** ⋯ 파티 메뉴. 없으면 버튼을 그리지 않는다(방장: 파티 없애기는 홈 맨 아래 버튼) */
  onMore?: () => void;
};

const HEIGHT = 340;
const FIGURE = 94;
const COLUMN = 92;
/** 말풍선 아래 끝이 무대 바닥에서 떨어진 거리(캐릭터 머리 위) */
const BUBBLE_BOTTOM = 168;

// 합의안이 나왔을 때 흩어 놓는 색종이: [왼쪽 비율, 위, 너비, 높이, 기울기, 색 번호(구성원 색, -1은 노랑)]
const CONFETTI: [number, number, number, number, number, number][] = [
  [0.1, 92, 8, 8, 20, 0],
  [0.25, 70, 6, 10, -30, 1],
  [0.77, 84, 8, 8, 40, 2],
  [0.9, 120, 6, 10, 15, 3],
  [0.16, 150, 6, 6, 0, -1],
  [0.85, 170, 6, 6, 0, -1],
];
const CONFETTI_YELLOW = "#F6D776";

/** 파티 홈 위쪽 무대: 떠 있는 위 줄(나가기·제목·설정·메뉴), 같이 가는 사람 캐릭터와 이름표, 빈자리, 말풍선. */
export default function PartyHomeStage(p: PartyHomeStageProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [bubbleW, setBubbleW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const columns = p.members.length + p.seats;
  const colW = width > 0 && columns > 0 ? Math.min(COLUMN, (width - spacing.sm) / columns) : COLUMN;
  const speaker = p.bubble === null ? -1 : p.members.findIndex((m) => m.id === p.bubble?.speakerId);
  const speakerX = width / 2 + (speaker - (columns - 1) / 2) * colW;
  const bubbleLeft = Math.max(spacing.sm + spacing.xs, Math.min(width - spacing.sm - spacing.xs - bubbleW, speakerX - bubbleW / 2));

  return (
    <View style={[styles.stage, { height: HEIGHT + insets.top }]} onLayout={onLayout}>
      <Svg style={styles.fill} width="100%" height={HEIGHT + insets.top} viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none">
        <Ellipse cx={50} cy={HEIGHT + 10} rx={70} ry={110} fill={colors.stageFloor} />
      </Svg>
      {p.confetti &&
        CONFETTI.map(([x, top, w, h, rot, c], i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: x * width,
              top: insets.top + top,
              width: w,
              height: h,
              borderRadius: c === -1 ? w / 2 : 2,
              backgroundColor: c === -1 ? CONFETTI_YELLOW : memberColors[c],
              transform: [{ rotate: `${rot}deg` }],
            }}
          />
        ))}

      <View style={[styles.top, { top: insets.top + spacing.sm }]}>
        <FloatButton label="내 파티 목록으로" onPress={p.onExit}>
          <Path d="M15 6l-6 6 6 6" stroke={colors.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </FloatButton>
        <View style={styles.titleBox}>
          <AppText variant="heading" numberOfLines={1} accessibilityRole="header">
            {p.title}
          </AppText>
          <AppText variant="caption" color={colors.textBody} numberOfLines={1}>
            {p.subtitle}
          </AppText>
        </View>
        <FloatButton label="설정" onPress={p.onSettings} size={20}>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke={colors.text} strokeWidth={1.8} strokeLinecap="round" fill="none" />
          <Circle cx={16} cy={7} r={2} stroke={colors.text} strokeWidth={1.8} fill="none" />
          <Circle cx={10} cy={17} r={2} stroke={colors.text} strokeWidth={1.8} fill="none" />
        </FloatButton>
        {p.onMore !== undefined && (
          <FloatButton label="파티 메뉴" onPress={p.onMore} size={20}>
            <Circle cx={5.5} cy={12} r={1.8} fill={colors.text} />
            <Circle cx={12} cy={12} r={1.8} fill={colors.text} />
            <Circle cx={18.5} cy={12} r={1.8} fill={colors.text} />
          </FloatButton>
        )}
      </View>

      {p.bubble !== null && speaker !== -1 && width > 0 && (
        <View
          style={[styles.bubble, { left: bubbleLeft, opacity: bubbleW > 0 ? 1 : 0 }]}
          onLayout={(e) => setBubbleW(e.nativeEvent.layout.width)}
          accessibilityLiveRegion="polite"
        >
          <AppText variant="bodyStrong" numberOfLines={1}>
            {p.bubble.text}
          </AppText>
          <View style={[styles.tail, { left: Math.max(radius.md, Math.min(bubbleW - radius.md - 12, speakerX - bubbleLeft - 6)) }]} />
        </View>
      )}

      <View style={styles.cast}>
        {p.members.map((m) => (
          <View
            key={m.id}
            style={[styles.member, { width: colW }]}
            accessible
            accessibilityLabel={`${m.name}${m.me ? ", 나" : ""}${p.showStatus ? (m.ready ? ", 준비 완료" : ", 성향 검사 전") : ""}`}
          >
            {m.ready ? (
              <AvatarArt color={m.color} chips={m.chips} variant="full" px={FIGURE} />
            ) : (
              <View style={[styles.ghost, { borderColor: outline(m.color) }]}>
                <AppText variant="title" color={outline(m.color)}>
                  ?
                </AppText>
              </View>
            )}
            <View style={styles.tag}>
              <AppText variant="caption" numberOfLines={1} style={styles.tagText}>
                {m.me ? `${m.name} · 나` : m.name}
              </AppText>
            </View>
            {p.showStatus && (
              <AppText variant="caption" tone={m.ready ? "success" : "default"} color={m.ready ? undefined : colors.textBody} style={m.ready ? styles.ok : undefined}>
                {m.ready ? "✓ 준비" : "검사 전"}
              </AppText>
            )}
          </View>
        ))}
        {Array.from({ length: p.seats }, (_, i) => (
          <Pressable
            key={`seat${i}`}
            onPress={p.onInvite}
            accessibilityRole="button"
            accessibilityLabel="빈자리, 친구 초대하기"
            style={({ pressed }) => [styles.member, { width: colW }, pressed && { opacity: pressedOpacity }]}
          >
            <View style={styles.seat}>
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path d="M12 5v14M5 12h14" stroke={colors.textMuted} strokeWidth={1.8} strokeLinecap="round" fill="none" />
              </Svg>
            </View>
            <View style={styles.tag}>
              <AppText variant="caption" style={styles.tagText}>
                초대
              </AppText>
            </View>
            {p.showStatus && (
              <AppText variant="caption" color={colors.textBody}>
                빈자리
              </AppText>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** 무대 위에 떠 있는 둥근 버튼: 눌리는 곳 48 안에 지름 40 흰 원 */
function FloatButton({ label, onPress, size = 22, children }: { label: string; onPress: () => void; size?: number; children: ReactNode }) {
  const styles = useStyles(createStyles);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.fbtn, pressed && { opacity: pressedOpacity }]}>
      <View style={styles.fbtnInner}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          {children}
        </Svg>
      </View>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    stage: { overflow: "hidden", backgroundColor: t.colors.mapLand },
    fill: { position: "absolute", left: 0, bottom: 0 },
    top: { position: "absolute", left: spacing.xs, right: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.xs },
    titleBox: { flex: 1, minWidth: 0 },
    fbtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    fbtnInner: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      boxShadow: t.elevation.float,
    },
    bubble: {
      position: "absolute",
      bottom: BUBBLE_BOTTOM,
      backgroundColor: t.colors.surface,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      boxShadow: t.elevation.float,
    },
    tail: { position: "absolute", bottom: -5, width: 12, height: 12, backgroundColor: t.colors.surface, transform: [{ rotate: "45deg" }] },
    cast: { position: "absolute", left: 0, right: 0, bottom: 14, flexDirection: "row", justifyContent: "center", alignItems: "flex-end" },
    member: { alignItems: "center", gap: 6 },
    tag: { maxWidth: "100%", borderRadius: radius.full, backgroundColor: t.colors.surface, paddingVertical: 3, paddingHorizontal: 10 },
    tagText: { fontWeight: "700" },
    ok: { fontWeight: "700" },
    ghost: {
      width: 64,
      height: 84,
      marginTop: 10,
      borderWidth: 2,
      borderStyle: "dashed",
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      borderBottomLeftRadius: 22,
      borderBottomRightRadius: 22,
      backgroundColor: "rgba(255,255,255,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    seat: {
      width: 60,
      height: 60,
      marginTop: 34,
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: t.colors.iconFaint,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
    },
  });
