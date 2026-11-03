import Svg, { Circle, Path } from "react-native-svg";

/** 공유 아이콘(점 셋을 이은 모양). 파티 홈 초대 코드 줄과 일정 탭 보내기 버튼이 같은 모양을 쓴다(11/4). */
export default function ShareIcon({ color, size = 20 }: { color: string; size?: number }) {
  const line = { stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={18} cy={5} r={2.5} {...line} />
      <Circle cx={6} cy={12} r={2.5} {...line} />
      <Circle cx={18} cy={19} r={2.5} {...line} />
      <Path d="M8.3 13.3l7.4 4.4M15.7 6.3l-7.4 4.4" {...line} />
    </Svg>
  );
}
