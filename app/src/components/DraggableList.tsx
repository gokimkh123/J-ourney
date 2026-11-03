import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { hitSize, radius, spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import { dropTarget, neighborKey, shiftsAfter, type Box } from "./dragLayout.ts";

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

/** 다른 줄이 비켜 주는 시간 */
const SHIFT_MS = 180;
/** 손을 뗀 줄이 새 자리에 붙는 시간 */
const SETTLE_MS = 160;
const ease = Easing.out(Easing.cubic);

/**
 * 손잡이(≡)를 잡고 위아래로 끌어 순서를 바꾸는 목록. 끄는 줄은 손가락을 따라 떠서 움직이고,
 * 지나가는 줄은 끄는 줄이 들어갈 자리를 만들며 미끄러지듯 비켜 준다(11/3 결정, 자리 계산은 dragLayout.ts).
 * 끌 수 있는 줄끼리만 자리를 바꾸고(다른 줄은 제자리), 놓으면 새 자리에 붙은 뒤 onDrop으로 알린다.
 * 움직임은 원래 Animated(네이티브 드라이버, transform만). 화면 읽기는 손잡이에서 위·아래로 한 칸씩 옮긴다.
 */
export default function DraggableList({ items, onDrop, onDragging, handleLabel }: DraggableListProps) {
  const styles = useStyles(createStyles);
  const boxes = useRef(new Map<string, Box>());
  const dy = useRef(new Animated.Value(0)).current;
  const shifts = useRef(new Map<string, Animated.Value>());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const target = useRef<string | null>(null);
  // 응답기 안에서 최신 목록을 읽으려고 ref에 둔다(응답기는 줄마다 한 번 만든다).
  const latest = useRef({ items, onDrop, onDragging });
  latest.current = { items, onDrop, onDragging };
  const responders = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());
  const orderKey = items.map((i) => i.key).join("|");
  const order = useRef(orderKey);
  order.current = orderKey;

  const shiftOf = (key: string): Animated.Value => {
    let value = shifts.current.get(key);
    if (value === undefined) {
      value = new Animated.Value(0);
      shifts.current.set(key, value);
    }
    return value;
  };

  const slide = (value: Animated.Value, toValue: number, duration: number, done?: () => void) => {
    Animated.timing(value, { toValue, duration, easing: ease, useNativeDriver: true }).start(() => done?.());
  };

  // 놓일 자리가 바뀌면 다른 줄을 옮긴 뒤의 자리로 비켜 준다.
  const makeRoom = (fromKey: string, toKey: string) => {
    const moves = shiftsAfter(latest.current.items, boxes.current, fromKey, toKey);
    for (const item of latest.current.items) {
      if (item.key !== fromKey) slide(shiftOf(item.key), moves.get(item.key) ?? 0, SHIFT_MS);
    }
  };

  const settleBack = () => {
    slide(dy, 0, SETTLE_MS);
    for (const value of shifts.current.values()) slide(value, 0, SHIFT_MS);
  };

  // 새 순서로 다시 그려지면 비켜 준 거리를 모두 0으로 되돌린다(줄이 이미 그 자리에 있어 화면은 그대로다).
  const shownOrder = useRef(orderKey);
  useLayoutEffect(() => {
    if (shownOrder.current === orderKey) return;
    shownOrder.current = orderKey;
    dy.setValue(0);
    for (const value of shifts.current.values()) {
      value.stopAnimation();
      value.setValue(0);
    }
  }, [orderKey, dy]);

  const finish = (key: string, moved: number) => {
    const to = dropTarget(latest.current.items, boxes.current, key, moved);
    const offset = shiftsAfter(latest.current.items, boxes.current, key, to).get(key) ?? 0;
    target.current = null;
    latest.current.onDragging?.(false);
    slide(dy, offset, SETTLE_MS, () => {
      // 끄던 줄을 새 자리에 둔 채로 내려놓는다. 부모가 순서를 바꾸면 위 효과가 거리를 0으로 되돌리고,
      // 바꾸지 않으면(예: 점심이 저녁 뒤로 가 서버가 받지 않음) 모두 제자리로 돌아간다.
      shiftOf(key).setValue(offset);
      setDragKey(null);
      const before = order.current;
      if (to !== key) latest.current.onDrop(key, to);
      // 그 사이 다른 줄을 다시 잡았으면 그 끌기를 흔들지 않는다.
      setTimeout(() => {
        if (order.current === before && target.current === null) settleBack();
      }, 0);
    });
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
        dy.stopAnimation();
        dy.setValue(0);
        shiftOf(key).setValue(0);
        target.current = key;
        setDragKey(key);
        latest.current.onDragging?.(true);
      },
      onPanResponderMove: (_e, g) => {
        dy.setValue(g.dy);
        const to = dropTarget(latest.current.items, boxes.current, key, g.dy);
        if (to === target.current) return;
        target.current = to;
        makeRoom(key, to);
      },
      onPanResponderRelease: (_e, g) => finish(key, g.dy),
      onPanResponderTerminate: () => {
        target.current = null;
        setDragKey(null);
        latest.current.onDragging?.(false);
        settleBack();
      },
    });
    responders.current.set(key, created);
    return created;
  };

  return (
    <View>
      {items.map((item) => {
        const lifted = dragKey === item.key;
        return (
          <Animated.View
            key={item.key}
            onLayout={(e: LayoutChangeEvent) => boxes.current.set(item.key, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}
            style={[
              styles.row,
              lifted ? [styles.lifted, { transform: [{ translateY: dy }, { scale: 1.02 }] }] : { transform: [{ translateY: shiftOf(item.key) }] },
            ]}
          >
            <View style={styles.node}>{item.node}</View>
            {item.draggable && (
              <View
                {...responderFor(item.key).panHandlers}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={handleLabel?.(item.key) ?? "순서 바꾸기"}
                accessibilityHint="위아래로 쓸어 한 칸씩 옮깁니다"
                accessibilityActions={[
                  { name: "decrement", label: "위로" },
                  { name: "increment", label: "아래로" },
                ]}
                onAccessibilityAction={(e) => {
                  const to = neighborKey(items, item.key, e.nativeEvent.actionName === "increment" ? 1 : -1);
                  if (to !== null) onDrop(item.key, to);
                }}
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
  });
