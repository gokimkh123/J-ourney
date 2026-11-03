import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Line } from "react-native-svg";

import { pressedOpacity, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import { AvatarStack } from "./Avatar.tsx";
import PlaceSticker, { type PlaceKind } from "./PlaceSticker.tsx";
import StatusPill from "./StatusPill.tsx";

const TIME_WIDTH = 44;
const STICKER = 38;

export type ScheduleItemProps = {
  /** "10:00". 없으면 시각 칸도 없다(일정 수정 중에는 시각이 확정 뒤 다시 계산돼서 숨긴다) */
  time?: string;
  title: string;
  /** "식사", "산책" 등 */
  category: string;
  /** "9,000원", "무료" — 화면이 포맷해서 넘긴다. 서버 일정처럼 비용을 모르면 생략 */
  costLabel?: string;
  /** false면 "지도 확인 필요" 라벨 */
  verified: boolean;
  /** forMembers: 누구를 위한 장소인지 */
  forMembers: { name: string; color: string }[];
  /** moveFromPrev를 사람이 읽는 문장으로(예: "버스 24분 · 1,500원"). 첫 항목이면 생략. */
  moveLabel?: string;
  /** 장소 종류 스티커. 없으면 기본 핀. 분류 → kind 변환은 화면이 한다. */
  kind?: PlaceKind;
  onPress?: () => void;
  /** 누를 때 읽어 줄 안내. 기본은 장소 정보 보기 */
  pressHint?: string;
  /** 있으면 오른쪽 끝에 ⋯ 버튼(일정 고치기). 없으면 버튼 자리도 없다 */
  onMore?: () => void;
  /** ⋯ 대신 글자 버튼(예: 뺀 곳의 "되돌리기") */
  moreLabel?: string;
  /** 일정 수정 중 바뀐 표시("뺌", "넣음", "바꿈", "순서", "옮김") */
  badge?: { label: string; tone: "accent" | "warning" | "danger" };
  /** 뺀 곳: 이름에 줄을 긋고 흐리게 */
  struck?: boolean;
  /** 있으면 시각을 눌러 바꿀 수 있다(메인 색 글자). 일정 탭의 시작 시각 바꾸기 */
  onTimePress?: () => void;
};

/** C1 합의 일정 한 줄: (이동) → 시간 | 스티커 | 이름·부가줄 | 대상 구성원. 누르면 C2 근거 보기. */
export default function ScheduleItem({
  time,
  title,
  category,
  costLabel,
  verified,
  forMembers,
  moveLabel,
  kind = "pin",
  onPress,
  pressHint,
  onMore,
  moreLabel,
  badge,
  struck = false,
  onTimePress,
}: ScheduleItemProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  return (
    <View style={styles.wrap}>
      {moveLabel !== undefined && (
        <View style={styles.move}>
          <Svg width={2} height={spacing.md + spacing.xs}>
            <Line x1={1} y1={0} x2={1} y2={spacing.md + spacing.xs} stroke={colors.border} strokeWidth={2} strokeDasharray="2 3" strokeLinecap="round" />
          </Svg>
          <AppText variant="caption" tone="muted">
            {moveLabel}
          </AppText>
        </View>
      )}
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={`${time === undefined ? "" : `${time} `}${title}, ${category}${costLabel === undefined ? "" : `, ${costLabel}`}${verified ? "" : ", 지도 확인 필요"}${badge === undefined ? "" : `, ${badge.label}`}`}
        accessibilityHint={onPress ? (pressHint ?? "고른 이유와 장소 정보를 봅니다") : undefined}
        style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      >
        {time !== undefined &&
          (onTimePress !== undefined ? (
            // 줄 전체 누르기와 따로, 시각만 눌러 시작 시각을 바꾼다. 보이는 글자는 작아도 눌리는 높이는 hitSize 근처까지 넓힌다.
            <Pressable
              onPress={onTimePress}
              accessibilityRole="button"
              accessibilityLabel={`${title} 시작 시각 ${time}`}
              accessibilityHint="시작 시각을 바꿉니다"
              hitSlop={{ top: spacing.sm, bottom: spacing.sm }}
              style={({ pressed }) => [styles.time, pressed && { opacity: pressedOpacity }]}
            >
              <AppText variant="numeric" tone="accent">
                {time}
              </AppText>
            </Pressable>
          ) : (
            <AppText variant="numeric" tone="muted" style={styles.time}>
              {time}
            </AppText>
          ))}
        <View style={struck && styles.faded}>
          <PlaceSticker kind={kind} size={STICKER} />
        </View>
        <View style={styles.body}>
          <AppText variant="bodyStrong" tone={struck ? "muted" : "default"} numberOfLines={1} style={struck && styles.struck}>
            {title}
          </AppText>
          <View style={styles.sub}>
            <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.subText}>
              {costLabel === undefined ? category : `${category} · ${costLabel}`}
            </AppText>
            {!verified && <StatusPill label="지도 확인 필요" tone="warning" />}
            {badge !== undefined && <StatusPill label={badge.label} tone={badge.tone} />}
          </View>
        </View>
        <AvatarStack people={forMembers} size="xs" />
        {onMore !== undefined && (
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel={moreLabel ?? `${title} 고치기`}
            hitSlop={{ top: spacing.xs, bottom: spacing.xs }}
            style={({ pressed }) => [moreLabel === undefined ? styles.more : styles.moreText, pressed && { opacity: pressedOpacity }]}
          >
            <AppText variant={moreLabel === undefined ? "heading" : "smallStrong"} tone={moreLabel === undefined ? "muted" : "accent"}>
              {moreLabel ?? "⋯"}
            </AppText>
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    wrap: {
      gap: spacing.xs,
    },
    move: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingLeft: TIME_WIDTH + spacing.sm + STICKER / 2 - 1,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    time: {
      width: TIME_WIDTH,
    },
    body: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xxs,
    },
    sub: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs + spacing.xxs,
    },
    subText: {
      flexShrink: 1,
    },
    // 보이는 글자는 작아도 눌리는 영역은 hitSize(48) 높이
    more: {
      width: 40,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      marginRight: -spacing.sm,
    },
    moreText: {
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: spacing.xs,
    },
    struck: {
      textDecorationLine: "line-through",
    },
    faded: {
      opacity: 0.4,
    },
  });
