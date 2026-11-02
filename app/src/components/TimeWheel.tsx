import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { spacing, useStyles, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";

// 한 줄 높이와 보이는 줄 수(가운데 줄이 고른 값, 위아래로 3줄씩)
const ROW = 44;
const SIDE = 3;
// 가운데에서 멀수록 작고 옅게(시안 v3: 32 → 26 → 22 → 19)
const LOOK = [
  { size: 32, opacity: 1 },
  { size: 26, opacity: 0.6 },
  { size: 22, opacity: 0.4 },
  { size: 19, opacity: 0.2 },
];

const pad2 = (n: number) => String(n).padStart(2, "0");

function Wheel({ count, value, onChange, label }: { count: number; value: number; onChange: (v: number) => void; label: string }) {
  const styles = useStyles(createStyles);
  const ref = useRef<ScrollView>(null);
  const [center, setCenter] = useState(value);
  const pick = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i));
    if (next === center) return;
    setCenter(next);
    onChange(next);
  };
  // 굴리는 동안 가운데 줄이 바뀔 때마다 고른 값도 바꾼다(멈춘 뒤 이벤트가 안 오는 경우가 있어서).
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => pick(Math.round(e.nativeEvent.contentOffset.y / ROW));
  const goTo = (i: number) => ref.current?.scrollTo({ y: i * ROW, animated: true });
  // 처음 그릴 때 고른 값으로 맞춘다(안드로이드는 contentOffset을 안 따를 때가 있어 한 번 더).
  const placed = useRef(false);
  const onLayout = () => {
    if (placed.current) return;
    placed.current = true;
    ref.current?.scrollTo({ y: value * ROW, animated: false });
  };
  return (
    <View
      style={styles.column}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: pad2(center) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const next = Math.max(0, Math.min(count - 1, center + (e.nativeEvent.actionName === "increment" ? 1 : -1)));
        pick(next);
        goTo(next);
      }}
    >
      <ScrollView
        ref={ref}
        onLayout={onLayout}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentOffset={{ x: 0, y: value * ROW }}
        contentContainerStyle={{ paddingVertical: SIDE * ROW }}
      >
        {Array.from({ length: count }, (_, i) => {
          const look = LOOK[Math.min(Math.abs(i - center), LOOK.length - 1)]!;
          return (
            <Pressable key={i} onPress={() => goTo(i)} style={styles.row} importantForAccessibility="no">
              <AppText
                variant="title"
                tone={i === center ? "default" : "muted"}
                style={{ fontSize: look.size, lineHeight: ROW, opacity: look.opacity, fontWeight: i === center ? "800" : "500", fontVariant: ["tabular-nums"] }}
              >
                {pad2(i)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export type TimeWheelProps = {
  /** "HH:MM"(24시간) */
  value: string;
  onChange: (value: string) => void;
};

/** 시(00~23)·분(00~59)을 위아래로 굴려 고르는 돌림판. 가운데 줄이 고른 값. */
export default function TimeWheel({ value, onChange }: TimeWheelProps) {
  const styles = useStyles(createStyles);
  const [h, m] = value.split(":").map(Number) as [number, number];
  const hour = useRef(Number.isFinite(h) ? h : 0);
  const minute = useRef(Number.isFinite(m) ? m : 0);
  const emit = () => onChange(`${pad2(hour.current)}:${pad2(minute.current)}`);
  return (
    <View style={styles.wheel}>
      <View style={styles.band} pointerEvents="none" />
      <Wheel count={24} value={hour.current} label="시" onChange={(v) => { hour.current = v; emit(); }} />
      <AppText variant="title" style={styles.colon} importantForAccessibility="no">
        :
      </AppText>
      <Wheel count={60} value={minute.current} label="분" onChange={(v) => { minute.current = v; emit(); }} />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wheel: { height: ROW * (SIDE * 2 + 1), flexDirection: "row", justifyContent: "center", gap: spacing.sm },
    band: {
      position: "absolute",
      left: 0,
      right: 0,
      top: ROW * SIDE,
      height: ROW,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.colors.border,
    },
    column: { width: 96 },
    row: { height: ROW, alignItems: "center", justifyContent: "center" },
    colon: { fontSize: 30, lineHeight: ROW, marginTop: ROW * SIDE, fontWeight: "700" },
  });
