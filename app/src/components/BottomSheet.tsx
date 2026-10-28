import { useMemo, useRef, type ReactNode } from "react";
import { PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type BottomSheetProps = {
  /** 시트 제목(예: "AI들이 장소를 조사하고 있어요") */
  title?: string;
  /** 제목 오른쪽 요약(예: "4명 조사 중"). action이 있으면 제목 아래 줄로 내려간다. */
  meta?: string;
  /** 제목 줄 오른쪽에 놓는 버튼(예: 일시정지). 시트가 접혀 있어도 보이고 눌린다. */
  action?: ReactNode;
  /**
   * 시트 윗선 위로 끌 수 있는 투명한 띠의 높이. 손잡이를 정확히 짚지 않아도 시트 바로 위를 잡고 끌 수 있다.
   * 부모가 시트 높이에 이 값을 더해 줘야 한다. 끌 수 있을 때(onCollapsedChange가 있을 때)만 쓴다.
   */
  dragExtra?: number;
  children?: ReactNode;
  /** 시트 맨 아래 고정 영역(주요 버튼) */
  footer?: ReactNode;
  /** 접힌 상태. 접히면 손잡이와 제목 줄만 보인다. */
  collapsed?: boolean;
  /** 있으면 손잡이·제목 줄을 누르거나 위아래로 쓸어서 접고 펼 수 있다. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * 있으면 손잡이·제목 줄을 잡고 끄는 동안 손가락을 따라 움직일 수 있다(부모가 높이를 바꾼다).
   * 손을 떼면 onDragEnd(총 이동 dy, 놓을 때 속도 vy)로 알려 주고, 어디에 붙일지는 부모가 정한다. 짧게 누르기만 하면 onCollapsedChange가 불린다.
   */
  onDragStart?: () => void;
  onDragMove?: (dy: number) => void;
  onDragEnd?: (dy: number, vy: number) => void;
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
  action,
  dragExtra = 0,
  children,
  footer,
  collapsed = false,
  onCollapsedChange,
  onDragStart,
  onDragMove,
  onDragEnd,
  style,
}: BottomSheetProps) {
  const styles = useStyles(createStyles);
  const toggleable = onCollapsedChange !== undefined;

  // PanResponder는 한 번만 만들고, 최신 값은 ref로 읽는다(드래그 도중 부모가 다시 그려져도 제스처가 끊기지 않게).
  const latest = useRef({ collapsed, onCollapsedChange, onDragStart, onDragMove, onDragEnd });
  latest.current = { collapsed, onCollapsedChange, onDragStart, onDragMove, onDragEnd };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // 시트 안 스크롤이 제스처를 가져가지 못하게 한다.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => latest.current.onDragStart?.(),
        onPanResponderMove: (_e, g) => latest.current.onDragMove?.(g.dy),
        onPanResponderRelease: (_e, g) => {
          const cur = latest.current;
          if (Math.abs(g.dy) < TAP_SLOP) {
            // 눌렀다 뗀 것: 접고 펴기. 끄는 중 조금 움직였어도 부모가 새 목표 높이로 자연스럽게 이어 간다.
            cur.onCollapsedChange?.(!cur.collapsed);
          } else if (cur.onDragEnd !== undefined) {
            cur.onDragEnd(g.dy, g.vy);
          } else if (g.dy > SWIPE_MIN) cur.onCollapsedChange?.(true);
          else if (g.dy < -SWIPE_MIN) cur.onCollapsedChange?.(false);
        },
        onPanResponderTerminate: (_e, g) => latest.current.onDragEnd?.(g.dy, g.vy),
      }),
    [],
  );

  const top = (
    <>
      <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no" />
      {(title !== undefined || meta !== undefined) && action === undefined && (
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

  // 제목 줄 오른쪽 버튼은 시트를 끌고 접는 영역과 따로 둔다(버튼을 눌러도 시트가 접히지 않게).
  // 손잡이와 제목 글자 쪽은 끌 수 있고, 읽어 주는 도구에는 "시트 접기/펴기" 버튼 하나로만 보인다.
  const dragProps = toggleable ? pan.panHandlers : {};
  const header =
    action === undefined ? null : (
      <View>
        <View {...dragProps} style={styles.handleArea} accessibilityElementsHidden importantForAccessibility="no">
          <View style={styles.handle} />
        </View>
        <View style={styles.headerAction}>
          <View
            {...dragProps}
            style={styles.headerText}
            accessible={toggleable}
            accessibilityRole={toggleable ? "button" : undefined}
            accessibilityLabel={
              toggleable ? `${title ?? ""} ${meta ?? ""} ${collapsed ? "시트 펴기" : "시트 접기"}`.trim() : undefined
            }
            accessibilityState={toggleable ? { expanded: !collapsed } : undefined}
            onAccessibilityTap={toggleable ? () => onCollapsedChange(!collapsed) : undefined}
          >
            {title !== undefined && (
              <AppText variant="heading" accessibilityRole={toggleable ? undefined : "header"}>
                {title}
              </AppText>
            )}
            {meta !== undefined && (
              <AppText variant="caption" tone="muted">
                {meta}
              </AppText>
            )}
          </View>
          <View style={styles.actionSlot}>{action}</View>
        </View>
      </View>
    );

  const sheetView = (
    <View style={[styles.sheet, style]}>
      {header !== null ? (
        header
      ) : toggleable ? (
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

  if (dragExtra > 0 && toggleable) {
    return (
      <View style={styles.extraRoot}>
        <View
          {...pan.panHandlers}
          style={{ height: dragExtra }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {sheetView}
      </View>
    );
  }
  return sheetView;
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
  extraRoot: {
    flex: 1,
  },
  handleArea: {
    // 손잡이를 잡기 쉽게 위아래 터치 영역을 넓힌다.
    paddingVertical: spacing.xs,
  },
  headerAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  headerText: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  actionSlot: {
    flexShrink: 0,
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
