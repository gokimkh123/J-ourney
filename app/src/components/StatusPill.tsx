import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing, toneColors, type Tone } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type StatusPillProps = {
  label: string;
  tone?: Tone;
  /** 앞에 붙는 작은 아바타·아이콘 */
  leading?: ReactNode;
};

/** "조사 중", "완료", "지도 확인 필요", "찬성" 같은 짧은 상태 라벨. 색만으로 뜻을 전하지 않도록 글자를 항상 쓴다. */
export default function StatusPill({ label, tone = "neutral", leading }: StatusPillProps) {
  const t = toneColors[tone];
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: tone === "neutral" || tone === "success" ? colors.surfaceSunken : t.bg },
        leading !== undefined && styles.withLeading,
      ]}
    >
      {leading}
      <AppText variant="label" color={t.fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    borderRadius: radius.full,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  withLeading: {
    paddingLeft: spacing.xxs,
  },
});
