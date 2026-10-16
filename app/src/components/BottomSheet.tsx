import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, elevation, radius, spacing } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type BottomSheetProps = {
  /** 시트 제목(예: "AI들이 장소를 조사하고 있어요") */
  title?: string;
  /** 제목 오른쪽 요약(예: "4명 조사 중") */
  meta?: string;
  children?: ReactNode;
  /** 시트 맨 아래 고정 영역(주요 버튼) */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * 지도 아래에 겹쳐 올라오는 둥근 시트. 끌어 올리기 동작은 없고 모양만 담당한다.
 * 위쪽 지도와 겹치도록 부모에서 marginTop을 음수로 주거나 position으로 놓는다.
 */
export default function BottomSheet({ title, meta, children, footer, style }: BottomSheetProps) {
  return (
    <View style={[styles.sheet, style]}>
      <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no" />
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
      <View style={styles.body}>{children}</View>
      {footer !== undefined && <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm + spacing.xs,
    boxShadow: elevation.sheet,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
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
  body: {
    gap: spacing.xs + spacing.xxs,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
