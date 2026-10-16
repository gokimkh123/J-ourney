import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type CardProps = {
  /** 카드 제목(왼쪽) */
  title?: string;
  /** 제목 오른쪽 보조 글자(예: "4명", "기준 7점 이상") */
  meta?: string;
  /** accent: 선택된 카드, sunken: 패널 안에 들어간 한 단계 낮은 상자 */
  tone?: "default" | "accent" | "sunken";
  /** 있으면 카드 전체가 눌린다. */
  onPress?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** 패널 상자. 안쪽 항목 사이 간격은 sm(8)로 고정. */
export default function Card({ title, meta, tone = "default", onPress, accessibilityLabel, children, style }: CardProps) {
  const styles = useStyles(createStyles);
  const toneStyle =
    tone === "accent" ? styles.accent : tone === "sunken" ? styles.sunken : undefined;

  const body = (
    <>
      {(title !== undefined || meta !== undefined) && (
        <View style={styles.header}>
          {title !== undefined && (
            <AppText variant="heading" style={styles.title} accessibilityRole="header">
              {title}
            </AppText>
          )}
          {meta !== undefined && (
            <AppText variant="caption" tone="muted">
              {meta}
            </AppText>
          )}
        </View>
      )}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        style={({ pressed }) => [styles.card, toneStyle, pressed && { opacity: pressedOpacity }, style]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.card, toneStyle, style]}>{body}</View>;
}

const createStyles = (t: Theme) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  accent: {
    borderColor: t.colors.accent,
  },
  sunken: {
    backgroundColor: t.colors.surfaceRaised,
    borderColor: "transparent",
    borderRadius: radius.md,
    padding: spacing.sm + spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
  },
});
