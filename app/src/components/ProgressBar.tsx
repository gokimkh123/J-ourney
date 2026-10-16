import { StyleSheet, View } from "react-native";

import { radius, useStyles, useTheme, type Theme } from "../theme/index.ts";

export type ProgressBarProps = {
  /** 0~1. 범위를 벗어나면 잘라낸다. */
  value: number;
  color?: string;
  size?: "sm" | "md";
  /** 읽어 주기용 설명(예: "민수 만족도 8점") */
  accessibilityLabel?: string;
};

export default function ProgressBar({ value, color, size = "md", accessibilityLabel }: ProgressBarProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const ratio = Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
  const height = size === "sm" ? 6 : 8;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      style={[styles.track, { height }]}
    >
      <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: color ?? colors.accent }]} />
    </View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  track: {
    alignSelf: "stretch",
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: t.colors.surfaceRaised,
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
  },
});
