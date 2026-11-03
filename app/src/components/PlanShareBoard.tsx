import type { Ref } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import type { ShareSheet } from "../lib/plan/planShare.ts";
import { lightColors, radius, spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";

const c = lightColors;

/**
 * 일정 이미지 공유 판(11/3 시안 B: 짧은 표). 화면 밖에 잠깐 그려 두고 찍는다(일정 탭 '공유' → 이미지로 보내기).
 * 앱이 어두운 모드여도 받는 사람이 어디서 봐도 잘 읽히게 밝은 색으로 고정한다.
 */
export default function PlanShareBoard({ sheet, onLayout, ref }: { sheet: ShareSheet; onLayout?: (e: LayoutChangeEvent) => void; ref?: Ref<View> }) {
  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={styles.board}>
      <View style={styles.head}>
        <AppText variant="caption" color={c.textMuted}>
          J-ourney · AI가 함께 짠 일정
        </AppText>
        <AppText variant="title" color={c.text}>
          {sheet.title}
        </AppText>
        {sheet.meta !== "" && (
          <AppText variant="small" color={c.textMuted}>
            {sheet.meta}
          </AppText>
        )}
      </View>
      {sheet.days.map((day) => (
        <View key={day.key} style={styles.day}>
          <View style={styles.dayHead}>
            <View style={styles.chip}>
              <AppText variant="label" color={c.accentSoftText}>
                {day.label}
              </AppText>
            </View>
            {day.date !== null && (
              <AppText variant="smallStrong" color={c.text}>
                {day.date}
              </AppText>
            )}
          </View>
          {day.lines.map((line, i) => (
            <View key={i} style={[styles.line, i > 0 && styles.lineRule]}>
              <AppText variant="numeric" color={c.textMuted} style={styles.time}>
                {line.time}
              </AppText>
              <AppText variant="body" color={c.text} style={styles.text}>
                {line.text}
              </AppText>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: { width: 360, padding: spacing.md, gap: spacing.sm + spacing.xs, backgroundColor: c.background },
  head: { gap: spacing.xxs, marginBottom: spacing.xxs },
  day: {
    padding: spacing.sm + spacing.xs,
    gap: spacing.xxs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  dayHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xxs },
  chip: { paddingVertical: spacing.xxs, paddingHorizontal: spacing.sm, borderRadius: radius.full, backgroundColor: c.accentSoft },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  lineRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  time: { width: 44 },
  text: { flex: 1, minWidth: 0 },
});
