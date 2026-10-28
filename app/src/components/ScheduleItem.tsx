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
  /** "10:00" */
  time: string;
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
        accessibilityLabel={`${time} ${title}, ${category}${costLabel === undefined ? "" : `, ${costLabel}`}${verified ? "" : ", 지도 확인 필요"}`}
        accessibilityHint={onPress ? "고른 이유와 장소 정보를 봅니다" : undefined}
        style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      >
        <AppText variant="numeric" tone="muted" style={styles.time}>
          {time}
        </AppText>
        <PlaceSticker kind={kind} size={STICKER} />
        <View style={styles.body}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          <View style={styles.sub}>
            <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.subText}>
              {costLabel === undefined ? category : `${category} · ${costLabel}`}
            </AppText>
            {!verified && <StatusPill label="지도 확인 필요" tone="warning" />}
          </View>
        </View>
        <AvatarStack people={forMembers} size="xs" />
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
  });
