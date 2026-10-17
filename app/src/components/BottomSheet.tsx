import { useMemo, type ReactNode } from "react";
import { PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type BottomSheetProps = {
  /** 시트 제목(예: "AI들이 장소를 조사하고 있어요") */
  title?: string;
  /** 제목 오른쪽 요약(예: "4명 조사 중") */
  meta?: string;
  children?: ReactNode;
  /** 시트 맨 아래 고정 영역(주요 버튼) */
  footer?: ReactNode;
  /** 접힌 상태. 접히면 손잡이와 제목 줄만 보인다. */
  collapsed?: boolean;
  /** 있으면 손잡이·제목 줄을 누르거나 위아래로 쓸어서 접고 펼 수 있다. */
  onCollapsedChange?: (collapsed: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

const TAP_SLOP = 8;
const SWIPE_MIN = 24;

/**
 * 지도 아래에 겹쳐 올라오는 둥근 시트. 손잡이·제목 줄을 누르거나 쓸면 접고 펼 수 있다(onCollapsedChange를 줄 때).
 * 위쪽 지도와 겹치도록 부모에서 marginTop을 음수로 주거나 position으로 놓는다.
 */
export default function BottomSheet({
  title,
  meta,
  children,
  footer,
  collapsed = false,
  onCollapsedChange,
  style,
}: BottomSheetProps) {
  const styles = useStyles(createStyles);
  const toggleable = onCollapsedChange !== undefined;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dy) < TAP_SLOP) onCollapsedChange?.(!collapsed);
          else if (g.dy > SWIPE_MIN) onCollapsedChange?.(true);
          else if (g.dy < -SWIPE_MIN) onCollapsedChange?.(false);
        },
      }),
    [collapsed, onCollapsedChange],
  );

  const top = (
    <>
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
    </>
  );

  return (
    <View style={[styles.sheet, style]}>
      {toggleable ? (
        <View
          {...pan.panHandlers}
          style={styles.top}
          accessible
          accessibilityRole="button"
          accessibilityLabel={collapsed ? "시트 펴기" : "시트 접기"}
          accessibilityState={{ expanded: !collapsed }}
          onAccessibilityTap={() => onCollapsedChange(!collapsed)}
        >
          {top}
        </View>
      ) : (
        top
      )}
      {/* 접혀도 본문은 그대로 두고 부모가 높이로 가린다. 그래야 높이가 부드럽게 줄고 늘어난다. 접힌 동안은 눌리거나 읽히지 않게 한다. */}
      <View
        style={styles.content}
        pointerEvents={collapsed ? "none" : "auto"}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
      >
        <View style={styles.body}>{children}</View>
        {footer !== undefined && <View style={styles.footer}>{footer}</View>}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) => StyleSheet.create({
  sheet: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm + spacing.xs,
    boxShadow: t.elevation.sheet,
  },
  top: {
    gap: spacing.sm + spacing.xs,
    // 누르기 쉽게 손잡이 위아래 터치 영역을 넓힌다.
    paddingBottom: spacing.xs,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: t.colors.border,
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
  content: {
    flexShrink: 1,
    minHeight: 0,
    gap: spacing.sm + spacing.xs,
  },
  body: {
    gap: spacing.xs + spacing.xxs,
    // 시트에 높이를 고정하면 본문이 남는 만큼만 차지하고 안쪽에서 스크롤된다.
    flexShrink: 1,
    minHeight: 0,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
