import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

// 앱 이름 "J-ourney" 글자 그림(정갈). 폰트가 아니라 선 12개다. 원본: 디자인 캔버스 Wordmark "sans".
const VIEW_W = 866;
const VIEW_H = 236;
const STROKES = [
  "M74 10 V124 A36 36 0 0 1 2 124",
  "M108 112 H140",
  "M175 110 A39 39 0 1 1 253 110 A39 39 0 1 1 175 110 Z",
  "M297 60 V110 A39 39 0 0 0 375 110",
  "M375 60 V160",
  "M430 60 V160",
  "M430 110 A39 39 0 0 1 469 71",
  "M500 60 V160",
  "M500 110 A39 39 0 0 1 578 110 V160",
  "M622 110 H700 A39 39 0 1 0 690.9 135.1",
  "M744 60 V110 A39 39 0 0 0 822 110",
  "M822 60 V176 A39 39 0 0 1 783 215 H765",
];

export type WordmarkProps = {
  /** 그림 너비. 높이는 비율대로 정해진다. */
  width: number;
  color: string;
};

/** "J-ourney" 글자 그림. 읽어 주기는 앱 이름 그대로. */
export default function Wordmark({ width, color }: WordmarkProps) {
  const height = Math.round((width * VIEW_H) / VIEW_W);
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="J-ourney" style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`-14 0 ${VIEW_W} ${VIEW_H}`}>
        {STROKES.map((d) => (
          <Path key={d} d={d} stroke={color} strokeWidth={22} strokeLinecap="butt" strokeLinejoin="round" fill="none" />
        ))}
      </Svg>
    </View>
  );
}
