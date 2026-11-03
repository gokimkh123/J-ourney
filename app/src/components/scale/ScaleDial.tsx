import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";

import AppText from "../AppText.tsx";
import { useStyles, useTheme, type Theme } from "../../theme/index.ts";
import { CX, CY, DIAL_H, DIAL_W, bandPath, labelPoint, pickedCircle, sectorPath, slotDeg } from "./scaleDial.ts";

export type ScaleDialProps = {
  min: number;
  max: number;
  /** 고른 점수. 아직 안 골랐으면 null */
  value: number | null;
  minLabel: string;
  maxLabel: string;
  /** 읽어 주기용 문항 글 */
  accessibilityLabel?: string;
  /** 점수가 정해질 때마다 불린다(손가락·화면 읽기 도구 모두) */
  onSelect: (value: number) => void;
  /** 손가락으로 칸을 눌렀을 때만 누른 점수와 함께 불린다. 화면이 다음 문항으로 넘길 때 쓴다. */
  onTap?: (value: number) => void;
};

/**
 * 반원형 점수 고르기. 점수 자리마다 살짝 부푼 띠 위에 숫자가 있고, 누르면 그 자리가 동그라미로 칠해지며 가운데에 크게 보인다.
 * 고른 데까지는 띠가 옅은 메인 색으로 찬다. 칸 수는 max - min + 1. 왼쪽 아래가 min, 오른쪽 아래가 max다.
 */
export default function ScaleDial({ min, max, value, minLabel, maxLabel, accessibilityLabel, onSelect, onTap }: ScaleDialProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const n = Math.max(1, max - min + 1);
  const selectedIndex = value === null ? -1 : value - min;
  const picked = selectedIndex < 0 || selectedIndex >= n ? null : pickedCircle(selectedIndex, n);
  const step = (delta: number) => {
    const next = value === null ? (delta > 0 ? min : max) : Math.min(max, Math.max(min, value + delta));
    onSelect(next);
  };
  return (
    <View style={styles.wrap}>
      <View
        style={styles.dial}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={value === null ? { text: "고르지 않음" } : { min, max, now: value, text: `${value}점` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${DIAL_W} ${DIAL_H}`}>
          <Path d={bandPath(slotDeg(0, n), slotDeg(n - 1, n), n)} fill={colors.surfaceRaised} />
          {selectedIndex > 0 && <Path d={bandPath(slotDeg(0, n), slotDeg(selectedIndex, n), n)} fill={colors.accentSoft} />}
          {picked !== null && <Circle cx={picked.x} cy={picked.y} r={picked.r} fill={colors.accent} />}
          {Array.from({ length: n }, (_, i) => {
            const on = i === selectedIndex;
            const p = on && picked !== null ? picked : labelPoint(i, n);
            const size = on ? PICKED_FONT : LABEL_FONT;
            return (
              // 누르는 자리는 띠보다 넓은 예전 칸 모양(보이지 않게)
              <G
                key={`s${i}`}
                onPress={() => {
                  onSelect(min + i);
                  onTap?.(min + i);
                }}
              >
                <Path d={sectorPath(i, n)} fill={HIT_FILL} />
                <SvgText
                  x={p.x}
                  y={p.y + size * 0.36}
                  textAnchor="middle"
                  fontSize={size}
                  fontWeight={on ? "800" : "700"}
                  fill={on ? colors.onAccent : i < selectedIndex ? colors.accentSoftText : colors.textMuted}
                >
                  {String(min + i)}
                </SvgText>
              </G>
            );
          })}
          {value === null ? (
            <SvgText x={CX} y={CY + 4} textAnchor="middle" fontSize={14} fill={colors.textMuted}>
              점수를 눌러 주세요
            </SvgText>
          ) : (
            <SvgText x={CX} y={CY + 22} textAnchor="middle" fontSize={64} fontWeight="800" fill={colors.text}>
              {String(value)}
            </SvgText>
          )}
        </Svg>
      </View>
      <View style={styles.labelRow}>
        <AppText variant="caption" tone="muted">
          {minLabel}
        </AppText>
        <AppText variant="caption" tone="muted">
          {maxLabel}
        </AppText>
      </View>
    </View>
  );
}

const LABEL_FONT = 13;
const PICKED_FONT = 16;
/** 보이지 않지만 눌리는 칠(fill="none"은 눌리지 않는다) */
const HIT_FILL = "rgba(0,0,0,0.001)";

const createStyles = (_t: Theme) =>
  StyleSheet.create({
    wrap: { alignSelf: "stretch" },
    dial: { width: "100%", aspectRatio: DIAL_W / DIAL_H },
    // 양 끝 칸 바로 아래, 반원이 비워 둔 자리에 놓는다.
    labelRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: "12%", marginTop: -8 },
  });
