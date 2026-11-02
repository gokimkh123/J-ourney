import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { disabledOpacity, hitSize, pressedOpacity, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type SheetOptionProps = {
  label: string;
  /** 앞에 붙는 기호 한 글자(↑ ↓ ⇄ ✕) */
  icon?: string;
  /** 오른쪽 끝 작은 글("+0.4km", "이날 쉼")이나 얼굴 묶음 */
  right?: ReactNode;
  /** 되돌리기 어려운 일(빼기)은 빨간 글자 */
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** 아래 시트 안의 행동 한 줄(일정 고치기 ⋯ 메뉴, 식당·장소 고르기). 눌리는 높이는 hitSize 이상. */
export default function SheetOption({ label, icon, right, danger = false, disabled = false, onPress }: SheetOptionProps) {
  const styles = useStyles(createStyles);
  const tone = danger ? "danger" : disabled ? "muted" : "default";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, pressed && !disabled && { opacity: pressedOpacity }, disabled && { opacity: disabledOpacity }]}
    >
      {icon !== undefined && (
        <AppText variant="bodyStrong" tone={danger ? "danger" : "muted"} style={styles.icon}>
          {icon}
        </AppText>
      )}
      <AppText variant="bodyStrong" tone={tone} numberOfLines={2} style={styles.label}>
        {label}
      </AppText>
      {typeof right === "string" ? (
        <AppText variant="caption" tone="muted">
          {right}
        </AppText>
      ) : (
        right !== undefined && <View>{right}</View>
      )}
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm + spacing.xs,
      minHeight: hitSize + spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.border,
    },
    icon: { width: 24, textAlign: "center" },
    label: { flex: 1, minWidth: 0 },
  });
