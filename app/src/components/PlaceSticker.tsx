import type { ReactElement } from "react";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { outline, pastel } from "../theme/index.ts";

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

// 캐릭터 몸통과 같은 그림책 방식: 바탕은 파스텔, 테두리·선은 같은 색 진하게, 안의 물건은 크림색 + 같은 테두리.
const CREAM = "#FFFDF7";

type Ink = { bg: string; line: string };

const INK: Record<PlaceKind, Ink> = {
  market: { bg: pastel(COLOR.market), line: outline(COLOR.market) },
  food: { bg: pastel(COLOR.food), line: outline(COLOR.food) },
  cafe: { bg: pastel(COLOR.cafe), line: outline(COLOR.cafe) },
  beach: { bg: pastel(COLOR.beach), line: outline(COLOR.beach) },
  view: { bg: pastel(COLOR.view), line: outline(COLOR.view) },
  pin: { bg: pastel(COLOR.pin), line: outline(COLOR.pin) },
};

function Face({ d, line }: { d: string; line: string }) {
  return <Path d={d} fill={CREAM} stroke={line} strokeWidth={1.4} strokeLinejoin="round" />;
}

function Stroke({ d, line }: { d: string; line: string }) {
  return <Path d={d} fill="none" stroke={line} strokeWidth={2} strokeLinecap="round" />;
}

function icon(kind: PlaceKind, { bg, line }: Ink): ReactElement {
  switch (kind) {
    case "market":
      return (
        <>
          <Face d="M5 12h22l-2-6H7z" line={line} />
          <Face d="M5 12q2.75 3 5.5 0t5.5 0 5.5 0 5.5 0" line={line} />
          <Face d="M8 15h16v11H8z" line={line} />
        </>
      );
    case "food":
      return (
        <>
          <Face d="M6 15h20q-1 9-10 9T6 15z" line={line} />
          <Stroke d="M12 8q-2 3 0 5M17 7q-2 3 0 6" line={line} />
        </>
      );
    case "cafe":
      return (
        <>
          <Face d="M8 12h14v7q0 5-7 5T8 19z" line={line} />
          <Stroke d="M22 14h2.5q2 0 2 3t-2.5 3H22" line={line} />
          <Stroke d="M12 6q-1.5 2 0 4M17 6q-1.5 2 0 4" line={line} />
        </>
      );
    case "beach":
      return (
        <>
          <Circle cx={21} cy={10} r={4} fill={CREAM} stroke={line} strokeWidth={1.4} />
          <Stroke d="M4 20q3-3.5 6 0t6 0 6 0 6 0M4 26q3-3.5 6 0t6 0 6 0 6 0" line={line} />
        </>
      );
    case "view":
      return (
        <>
          <Stroke d="M4 22Q16 4 28 22" line={line} />
          <Stroke d="M4 24h24M10 17v7M16 12v12M22 17v7" line={line} />
        </>
      );
    default:
      return (
        <>
          <Face d="M16 27C11 21 8 17 8 13a8 8 0 0 1 16 0c0 4-3 8-8 14z" line={line} />
          <Circle cx={16} cy={13} r={3} fill={bg} stroke={line} strokeWidth={1.2} />
        </>
      );
  }
}

/** 장소 종류를 보여 주는 둥근 사각 스티커. 장식이라 이름은 부모가 읽어 준다. */
export default function PlaceSticker({ kind = "pin", size = 38 }: { kind?: PlaceKind; size?: PlaceStickerSize }) {
  const ink = INK[kind];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* 테두리가 잘리지 않게 viewBox를 1씩 넓힌다. */}
      <Svg width={size} height={size} viewBox="-1 -1 34 34">
        <Rect x={0} y={0} width={32} height={32} rx={32 * 0.32} fill={ink.bg} stroke={ink.line} strokeWidth={1.4} />
        {icon(kind, ink)}
      </Svg>
    </View>
  );
}
