import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { budgetFromRatio, ratioFromBudget, stepBudget } from "../lib/trip/budget.ts";
import { formatWon } from "../lib/ui/format.ts";
import { radius, useStyles, type Theme } from "../theme/index.ts";

export type BudgetSliderProps = {
  value: number;
  onChange: (value: number) => void;
  /** 스크린리더가 읽는 이름 */
  label?: string;
};

const THUMB = 28;
const HIT = 44;
const TRACK = 6;

/** 1만~1,000만 원을 로그 눈금으로 고르는 슬라이더. 손가락으로 끌거나 눌러서 옮기고, 스크린리더는 위/아래로 한 칸씩. */
export default function BudgetSlider({ value, onChange, label = "한 사람당 예산" }: BudgetSliderProps) {
  const styles = useStyles(createStyles);
  const [width, setWidth] = useState(0);
  const latest = useRef({ value, onChange, width });
  latest.current = { value, onChange, width };
  const startRatio = useRef(0);

  const pan = useMemo(() => {
    const ratioAt = (x: number) => {
      const usable = latest.current.width - THUMB;
      return usable <= 0 ? 0 : Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        // 자식은 pointerEvents="none"이라 locationX가 이 영역 기준이다.
        const ratio = ratioAt(event.nativeEvent.locationX);
        startRatio.current = ratio;
        latest.current.onChange(budgetFromRatio(ratio));
      },
      onPanResponderMove: (_event, gesture) => {
        const usable = latest.current.width - THUMB;
        if (usable <= 0) return;
        const ratio = Math.min(1, Math.max(0, startRatio.current + gesture.dx / usable));
        latest.current.onChange(budgetFromRatio(ratio));
      },
    });
  }, []);

  const ratio = ratioFromBudget(value);
  const usable = Math.max(0, width - THUMB);
  const thumbLeft = ratio * usable;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={styles.hit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: formatWon(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onChange(stepBudget(value, e.nativeEvent.actionName === "increment" ? 1 : -1))}
    >
      <View style={styles.track} pointerEvents="none" />
      <View style={[styles.fill, { width: thumbLeft + THUMB / 2 }]} pointerEvents="none" />
      <View style={[styles.thumb, { left: thumbLeft }]} pointerEvents="none" />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    hit: { height: HIT, justifyContent: "center" },
    track: {
      position: "absolute",
      left: THUMB / 2,
      right: THUMB / 2,
      height: TRACK,
      borderRadius: radius.full,
      backgroundColor: t.colors.border,
    },
    fill: {
      position: "absolute",
      left: 0,
      height: TRACK,
      borderRadius: radius.full,
      backgroundColor: t.colors.accent,
    },
    thumb: {
      position: "absolute",
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      backgroundColor: t.colors.surfaceRaised,
      borderWidth: 2,
      borderColor: t.colors.accent,
    },
  });
