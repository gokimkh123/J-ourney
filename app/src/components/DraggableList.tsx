import { useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { hitSize, radius, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

export type DraggableItem = {
  key: string;
  /** 오른쪽 손잡이(≡)로 끌어서 옮길 수 있는가. false면 제자리에 고정 */
  draggable: boolean;
  node: ReactNode;
};

export type DraggableListProps = {
  items: DraggableItem[];
  /** 끌던 줄을 놓은 곳: 끌 수 있는 줄 중 target 줄의 자리로 옮긴다(같은 자리면 부르지 않음) */
  onDrop: (fromKey: string, targetKey: string) => void;
  /** 끄는 동안 바깥 스크롤을 멈추게 부모에게 알린다 */
  onDragging?: (dragging: boolean) => void;
  /** 손잡이 읽어 주기 이름: "감천문화마을 순서 바꾸기" */
  handleLabel?: (key: string) => string;
};

type Box = { y: number; h: number };

/**
 * 손잡이(≡)를 잡고 위아래로 끌어 순서를 바꾸는 목록. 끄는 줄은 손가락을 따라 떠서 움직이고, 놓일 자리에 선이 보인다.
 * 끌 수 있는 줄끼리만 자리를 바꾸고(다른 줄은 제자리), 놓으면 onDrop으로 알린다. 그림 움직임은 원래 Animated(네이티브 드라이버).
 */
export default function DraggableList({ items, onDrop, onDragging, handleLabel }: DraggableListProps) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const boxes = useRef(new Map<string, Box>());
  const dy = useRef(new Animated.Value(0)).current;
  const [drag, setDrag] = useState<{ key: string; target: string } | null>(null);
  // 응답기 안에서 최신 목록을 읽으려고 ref에 둔다(응답기는 줄마다 한 번 만든다).
  const latest = useRef({ items, onDrop, onDragging });
  latest.current = { items, onDrop, onDragging };
  const responders = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

  const targetOf = (key: string, moved: number): string => {
    const from = boxes.current.get(key);
    if (from === undefined) return key;
    const center = from.y + from.h / 2 + moved;
    let best = key;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const item of latest.current.items) {
      const box = boxes.current.get(item.key);
      if (!item.draggable || box === undefined) continue;
      const gap = Math.abs(box.y + box.h / 2 - center);
      if (gap < bestGap) {
        bestGap = gap;
        best = item.key;
      }
    }
    return best;
  };

  const responderFor = (key: string) => {
    const existing = responders.current.get(key);
    if (existing !== undefined) return existing;
    const created = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 끄는 중에는 바깥 스크롤이 가져가지 못하게 한다.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dy.setValue(0);
        setDrag({ key, target: key });
        latest.current.onDragging?.(true);
      },
      onPanResponderMove: (_e, g) => {
        dy.setValue(g.dy);
        const target = targetOf(key, g.dy);
        setDrag((prev) => (prev === null || prev.target === target ? prev : { key, target }));
      },
      onPanResponderRelease: (_e, g) => {
        const target = targetOf(key, g.dy);
        dy.setValue(0);
        setDrag(null);
        latest.current.onDragging?.(false);
        if (target !== key) latest.current.onDrop(key, target);
      },
      onPanResponderTerminate: () => {
        dy.setValue(0);
        setDrag(null);
        latest.current.onDragging?.(false);
      },
    });
    responders.current.set(key, created);
    return created;
  };

  const order = items.map((i) => i.key);
  const indicator = (() => {
    if (drag === null || drag.target === drag.key) return null;
    const box = boxes.current.get(drag.target);
    if (box === undefined) return null;
    const after = order.indexOf(drag.target) > order.indexOf(drag.key);
    return after ? box.y + box.h : box.y;
  })();

  return (
    <View>
      {items.map((item) => {
        const dragging = drag?.key === item.key;
        return (
          <Animated.View
            key={item.key}
            onLayout={(e: LayoutChangeEvent) => boxes.current.set(item.key, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}
            style={[styles.row, dragging && [styles.lifted, { transform: [{ translateY: dy }, { scale: 1.02 }] }]]}
          >
            <View style={styles.node}>{item.node}</View>
            {item.draggable && (
              <View
                {...responderFor(item.key).panHandlers}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={handleLabel?.(item.key) ?? "순서 바꾸기"}
                style={styles.handle}
              >
                <AppText variant="heading" tone="muted">
                  ≡
                </AppText>
              </View>
            )}
          </Animated.View>
        );
      })}
      {indicator !== null && <View pointerEvents="none" style={[styles.indicator, { top: indicator - 1, backgroundColor: colors.accent }]} />}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", borderRadius: radius.md },
    node: { flex: 1, minWidth: 0 },
    // 끄는 줄은 바탕을 깔고 위로 띄운다(다른 줄 위에 그려지게).
    lifted: { zIndex: 10, elevation: 6, backgroundColor: t.colors.surface, boxShadow: t.elevation.float },
    handle: { width: 40, minHeight: hitSize, alignItems: "center", justifyContent: "center", marginRight: -spacing.sm },
    indicator: { position: "absolute", left: 0, right: 0, height: 2, borderRadius: 1 },
  });
