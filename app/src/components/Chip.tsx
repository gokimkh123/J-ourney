import { Pressable, StyleSheet, View } from "react-native";

import { disabledOpacity, hitSize, pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type ChipProps = {
  label: string;
  emoji?: string;
  /** 고를 수 있는 칩일 때 선택 여부 */
  selected?: boolean;
  disabled?: boolean;
  /** 없으면 눌리지 않는 표시용 칩 */
  onPress?: () => void;
  size?: "sm" | "md";
};

/** 성향 칩, 이동 수단 선택, 좋아요 고르기 등에 쓰는 둥근 칩. */
export default function Chip({ label, emoji, selected = false, disabled = false, onPress, size = "md" }: ChipProps) {
  const styles = useStyles(createStyles);
  const text = emoji ? `${emoji} ${label}` : label;
  const pad = size === "sm" ? styles.sm : styles.md;

  if (!onPress) {
    return (
      <View style={[styles.base, pad, selected && styles.selected]}>
        <AppText variant={size === "sm" ? "caption" : "small"} tone={selected ? "accent" : "default"}>
          {text}
        </AppText>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      hitSlop={spacing.xs}
      style={({ pressed }) => [
        styles.base,
        pad,
        selected && styles.selected,
        pressed && { opacity: pressedOpacity },
        disabled && { opacity: disabledOpacity },
      ]}
    >
      <AppText variant={size === "sm" ? "caption" : "small"} style={selected ? styles.selectedText : undefined}>
        {text}
      </AppText>
    </Pressable>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  sm: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  md: {
    minHeight: hitSize,
    justifyContent: "center",
    paddingVertical: spacing.xs + spacing.xxs,
    paddingHorizontal: spacing.md - spacing.xs,
  },
  selected: {
    backgroundColor: t.colors.accentSoft,
    borderColor: t.colors.accent,
  },
  selectedText: {
    color: t.colors.accentSoftText,
  },
});
