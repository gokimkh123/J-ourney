import type { ReactElement } from "react";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";


export type PlaceKind = "market" | "food" | "cafe" | "beach" | "view" | "pin";
export type PlaceStickerSize = 32 | 38 | 48;

// 스티커 색은 그림의 일부라 밝은·다크에서 같다.
const COLOR: Record<PlaceKind, string> = {
  market: "#F4A261",
  food: "#E76F51",
  cafe: "#B08968",
  beach: "#4FB3D9",
  view: "#7C83DB",
  pin: "#9AA3AE",
};

const WHITE = "#FFFFFF";

const ICON: Record<PlaceKind, ReactElement> = {
  market: (
    <>
      <Path d="M5 12h22l-2-6H7z" fill={WHITE} opacity={0.95} />
      <Path d="M5 12q2.75 3 5.5 0t5.5 0 5.5 0 5.5 0" fill={WHITE} />
      <Rect x={8} y={15} width={16} height={11} rx={1.5} fill={WHITE} opacity={0.85} />
    </>
  ),
  food: (
    <>
      <Path d="M6 15h20q-1 9-10 9T6 15z" fill={WHITE} />
      <Path d="M12 8q-2 3 0 5M17 7q-2 3 0 6" stroke={WHITE} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </>
  ),
  cafe: (
    <>
      <Path d="M8 12h14v7q0 5-7 5T8 19z" fill={WHITE} />
      <Path d="M22 14h2.5q2 0 2 3t-2.5 3H22" fill="none" stroke={WHITE} strokeWidth={2} />
      <Path d="M12 6q-1.5 2 0 4M17 6q-1.5 2 0 4" stroke={WHITE} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </>
  ),
  beach: (
    <>
      <Circle cx={21} cy={10} r={4} fill={WHITE} />
      <Path d="M4 20q3-3.5 6 0t6 0 6 0 6 0M4 26q3-3.5 6 0t6 0 6 0 6 0" stroke={WHITE} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    </>
  ),
  view: (
    <>
      <Path d="M4 22Q16 4 28 22" stroke={WHITE} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Path d="M4 24h24M10 17v7M16 12v12M22 17v7" stroke={WHITE} strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),
  pin: (
    <>
      <Path d="M16 27C11 21 8 17 8 13a8 8 0 0 1 16 0c0 4-3 8-8 14z" fill={WHITE} />
      <Circle cx={16} cy={13} r={3} fill={COLOR.pin} />
    </>
  ),
};

/** 장소 종류를 보여 주는 둥근 사각 스티커. 장식이라 이름은 부모가 읽어 준다. */
export default function PlaceSticker({ kind = "pin", size = 38 }: { kind?: PlaceKind; size?: PlaceStickerSize }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 32 32">
        <Rect x={0} y={0} width={32} height={32} rx={32 * 0.32} fill={COLOR[kind]} />
        {ICON[kind]}
      </Svg>
    </View>
  );
}

