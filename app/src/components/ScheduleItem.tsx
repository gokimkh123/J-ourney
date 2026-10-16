import { Pressable, StyleSheet, View } from "react-native";

import { colors, pressedOpacity, radius, spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import { AvatarStack } from "./Avatar.tsx";
import StatusPill from "./StatusPill.tsx";

const TIME_WIDTH = 44;

export type ScheduleItemProps = {
  /** "10:00" */
  time: string;
  title: string;
  /** "식사", "산책" 등 */
  category: string;
  /** "9,000원", "무료" — 화면이 포맷해서 넘긴다 */
  costLabel: string;
  /** false면 "지도 확인 필요" 라벨 */
  verified: boolean;
  /** forMembers: 누구를 위한 장소인지 */
  forMembers: { name: string; color: string }[];
  /** moveFromPrev를 사람이 읽는 문장으로(예: "버스 24분 · 1,500원"). 첫 항목이면 생략. */
  moveLabel?: string;
  onPress?: () => void;
};

/** C1 합의 일정 한 칸: (이동) → 시간 | 장소 카드. 누르면 C2 근거 보기. */
export default function ScheduleItem({
  time,
  title,
  category,
  costLabel,
  verified,
  forMembers,
  moveLabel,
  onPress,
}: ScheduleItemProps) {
  return (
    <View style={styles.wrap}>
      {moveLabel !== undefined && (
        <View style={styles.move}>
          <View style={styles.moveLine} />
          <AppText variant="caption" tone="muted">
            {moveLabel}
          </AppText>
        </View>
      )}
      <View style={styles.row}>
        <AppText variant="numeric" tone="muted" style={styles.time}>
          {time}
        </AppText>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? "button" : undefined}
          accessibilityLabel={`${time} ${title}, ${category}, ${costLabel}${verified ? "" : ", 지도 확인 필요"}`}
          accessibilityHint={onPress ? "고른 이유와 장소 정보를 봅니다" : undefined}
          style={({ pressed }) => [styles.card, pressed && { opacity: pressedOpacity }]}
        >
          <View style={styles.top}>
            <AppText variant="bodyStrong" style={styles.title} numberOfLines={2}>
              {title}
            </AppText>
            <AppText variant="small" tone="muted">
              {costLabel}
            </AppText>
          </View>
          <View style={styles.meta}>
            <View style={styles.pills}>
              <StatusPill label={category} />
              {!verified && <StatusPill label="지도 확인 필요" tone="warning" />}
            </View>
            <AvatarStack people={forMembers} size="xs" />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  move: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: TIME_WIDTH + spacing.sm + spacing.md,
  },
  moveLine: {
    width: 2,
    height: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  time: {
    width: TIME_WIDTH,
    paddingTop: spacing.sm + spacing.xs,
  },
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + spacing.xxs,
    paddingHorizontal: spacing.sm + spacing.xs,
    gap: spacing.sm,
  },
  top: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    flex: 1,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    flexShrink: 1,
  },
});
