import { Pressable, StyleSheet, View } from "react-native";

import { pressedOpacity, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type StepperProps = {
  /** "최소 만족도" */
  label: string;
  /** "모두가 이 점수 이상이면 합의" */
  description?: string;
  value: number;
  /** 값 뒤에 붙는 단위. "점", "회" */
  unit?: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

/** 왼쪽에 이름과 설명, 오른쪽에 − 값 + 로 숫자 하나를 바꾸는 한 줄. */
export default function Stepper({ label, description, value, unit = "", min, max, onChange }: StepperProps) {
  const styles = useStyles(createStyles);
  const canDown = value > min;
  const canUp = value < max;

  return (
    <View style={styles.row} accessible={false}>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description !== undefined && (
          <AppText variant="caption" tone="muted">
            {description}
          </AppText>
        )}
      </View>
      <View style={styles.controls}>
        <Pressable
          onPress={() => onChange(value - 1)}
          disabled={!canDown}
          accessibilityRole="button"
          accessibilityLabel={`${label} 줄이기`}
          accessibilityState={{ disabled: !canDown }}
          style={({ pressed }) => [styles.button, !canDown && styles.off, pressed && { opacity: pressedOpacity }]}
        >
          <AppText variant="title" tone="muted" style={styles.sign}>
            −
          </AppText>
        </Pressable>
        <AppText variant="title" align="center" style={styles.value} accessibilityLabel={`${value}${unit}`}>
          {value}
          {unit}
        </AppText>
        <Pressable
          onPress={() => onChange(value + 1)}
          disabled={!canUp}
          accessibilityRole="button"
          accessibilityLabel={`${label} 늘리기`}
          accessibilityState={{ disabled: !canUp }}
          style={({ pressed }) => [styles.button, !canUp && styles.off, pressed && { opacity: pressedOpacity }]}
        >
          <AppText variant="title" tone="muted" style={styles.sign}>
            +
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      minHeight: 56,
    },
    text: { flex: 1, gap: spacing.xxs },
    controls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    button: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      backgroundColor: t.colors.surfaceSunken,
      alignItems: "center",
      justifyContent: "center",
    },
    off: { opacity: 0.35 },
    sign: { lineHeight: 24 },
    value: { minWidth: 48 },
  });
