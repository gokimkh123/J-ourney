import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { pressedOpacity, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type TopBarProps = {
  /** 파티 안이면 파티 이름(없으면 이름 칸 없이 "내 파티"만). 파티 밖(초기 화면)이면 생략 */
  party?: { name: string | null };
  /** 왼쪽 "‹ 내 파티"를 눌렀을 때. party가 있을 때만 쓴다. */
  onExitParty?: () => void;
  onSettings: () => void;
};

/**
 * 탭 화면 맨 위의 얇은 줄. 제목은 없고, 파티 안에서는 왼쪽에 "‹ 내 파티"와 파티 이름, 오른쪽에는 설정 버튼이 있다.
 */
export default function TopBar({ party, onExitParty, onSettings }: TopBarProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        {party !== undefined ? (
          <Pressable
            onPress={onExitParty}
            accessibilityRole="button"
            accessibilityLabel={party.name ? `내 파티 목록으로, 지금 ${party.name}` : "내 파티 목록으로"}
            hitSlop={8}
            style={({ pressed }) => [styles.exit, pressed && { opacity: pressedOpacity }]}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path d="M15 5l-7 7 7 7" stroke={colors.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
            <AppText variant="bodyStrong">내 파티</AppText>
            {party.name ? (
              <View style={styles.chip}>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {party.name}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel="설정"
          hitSlop={4}
          style={({ pressed }) => [styles.gear, pressed && { opacity: pressedOpacity }]}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" stroke={colors.textMuted} strokeWidth={1.9} strokeLinecap="round" fill="none" />
            <Circle cx={15} cy={7} r={2} stroke={colors.textMuted} strokeWidth={1.9} fill="none" />
            <Circle cx={9} cy={12} r={2} stroke={colors.textMuted} strokeWidth={1.9} fill="none" />
            <Circle cx={17} cy={17} r={2} stroke={colors.textMuted} strokeWidth={1.9} fill="none" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: { backgroundColor: t.colors.background },
    row: {
      height: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: spacing.sm,
      paddingRight: spacing.sm,
    },
    exit: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, flexShrink: 1 },
    chip: {
      flexShrink: 1,
      marginLeft: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
      borderRadius: radius.full,
      backgroundColor: t.colors.surfaceRaised,
    },
    gear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  });
