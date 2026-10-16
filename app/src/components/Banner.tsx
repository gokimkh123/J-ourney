import { StyleSheet, View } from "react-native";

import { colors, radius, spacing, toneColors } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Button from "./Button.tsx";

export type BannerProps = {
  text: string;
  tone?: "accent" | "warning" | "danger";
  /** 오른쪽 작은 버튼(예: "다시 시도") */
  actionLabel?: string;
  onAction?: () => void;
};

/** 화면 위쪽 안내 띠: "지도 확인 필요", 연결 끊김, 오류 등. */
export default function Banner({ text, tone = "warning", actionLabel, onAction }: BannerProps) {
  const t = toneColors[tone];
  return (
    <View
      accessibilityRole={tone === "accent" ? "summary" : "alert"}
      style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}
    >
      <AppText variant="small" color={tone === "warning" ? colors.warningText : t.fg} style={styles.text}>
        {text}
      </AppText>
      {actionLabel !== undefined && onAction && (
        <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + spacing.xs,
  },
  text: {
    flex: 1,
  },
});
