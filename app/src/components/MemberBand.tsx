import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useStyles, useTheme, type Theme } from "../theme/index.ts";
import Avatar, { type AvatarChip } from "./Avatar.tsx";

export type MemberBandMember = { id: string; name: string; color: string; chips?: AvatarChip[] };

export type MemberBandProps = {
  members: MemberBandMember[];
  height?: number;
  /** 상태 표시줄 뒤까지 색이 올라오도록 화면이 안전 영역 높이를 넘긴다. */
  paddingTop?: number;
};

const BAND_W = 390;
const CHARACTER_H = 82;
const BOTTOM_RADIUS = 28;
// [cx, cy, r, 색] — 폭 390, 높이 176 기준
const DOTS: [number, number, number, string][] = [
  [34, 40, 5, "#F9A8BC"],
  [330, 52, 4, "#FFD84D"],
  [70, 110, 3, "#9CD3F0"],
  [300, 120, 4, "#B6E2A1"],
  [188, 34, 3, "#FFD84D"],
  [360, 92, 3, "#F9A8BC"],
  [18, 92, 3, "#B6E2A1"],
];
const BASE_HEIGHT = 176;

/** 바닥에 깔리는 물결 한 줄: 28 길이 한 마디를 폭만큼 이어 붙인다. */
function wavePath(width: number, y: number): string {
  const count = Math.ceil(width / 28) + 1;
  return `M0 ${y}${"q7 -6 14 0t14 0".repeat(count)}`;
}

/** B3 위쪽 띠: 합의한 구성원 캐릭터가 땅색 바탕 위에 나란히 서 있다. */
export default function MemberBand({ members, height = BASE_HEIGHT, paddingTop = 0 }: MemberBandProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [width, setWidth] = useState(BAND_W);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const total = height + paddingTop;
  const sx = width / BAND_W;
  const sy = total / BASE_HEIGHT;

  return (
    <View style={[styles.band, { height: total, paddingTop }]} onLayout={onLayout} accessibilityLabel={members.map((m) => m.name).join(", ")}>
      <Svg width={width} height={total} style={StyleSheet.absoluteFill} pointerEvents="none">
        {DOTS.map(([cx, cy, r, color]) => (
          <Circle key={`${cx}-${cy}`} cx={cx * sx} cy={cy * sy} r={r} fill={color} opacity={0.9} />
        ))}
        <Path
          d={wavePath(width, total - 14)}
          stroke={colors.mapLandEdge}
          strokeWidth={2.4}
          strokeLinecap="round"
          fill="none"
          opacity={0.5}
        />
      </Svg>
      <View style={styles.row}>
        {members.map((m, i) => (
          <View key={m.id} style={[styles.slot, i % 2 === 1 && styles.raised]}>
            <Avatar color={m.color} chips={m.chips} name={m.name} variant="full" height={CHARACTER_H} />
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    band: {
      backgroundColor: t.colors.mapLand,
      borderBottomLeftRadius: BOTTOM_RADIUS,
      borderBottomRightRadius: BOTTOM_RADIUS,
      overflow: "hidden",
      justifyContent: "flex-end",
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-around",
      alignItems: "flex-end",
      paddingBottom: 22,
      paddingHorizontal: 12,
    },
    slot: {
      alignItems: "center",
    },
    raised: {
      marginBottom: 6,
    },
  });
