import { memo } from "react";
import Svg, { Circle, Ellipse, Path, Rect, Text as SvgText } from "react-native-svg";

import type { MapArtPalette } from "../../theme/index.ts";
import { shade } from "./regionArt.ts";

export const FLAG_W = 34;
export const FLAG_H = 40;
/** 깃발 발끝(= 위치)이 그림 안에서 놓인 점 */
export const FLAG_FOOT = { x: 3, y: 38 };

const WHITE = "#FFFFFF";
const BALL = "#FFD84D";
const POLE = "#8A6A45";

/** 부산 그림 지도의 깃발 핀. 발끝이 위치이고, 색은 처음 제안한 구성원의 원래 색이다. */
function Flag({ color, label, palette }: { color: string; label?: string; palette: MapArtPalette }) {
  return (
    <Svg width={FLAG_W} height={FLAG_H} viewBox={`0 0 ${FLAG_W} ${FLAG_H}`}>
      <Ellipse cx={FLAG_FOOT.x} cy={FLAG_FOOT.y} rx={7} ry={2.4} fill={palette.shadow} />
      <Rect x={1.5} y={4} width={3} height={34} rx={1.5} fill={POLE} />
      <Path d="M4.5 5H28Q24 11.5 28 18H4.5Z" fill={color} stroke={shade(color, 0.8)} strokeWidth={1.2} strokeLinejoin="round" />
      {label !== undefined && label !== "" && (
        <SvgText x={15} y={15.5} fontSize={11} fontWeight="800" fill={WHITE} textAnchor="middle">
          {label}
        </SvgText>
      )}
      {palette.night && <Circle cx={3} cy={4} r={6} fill={BALL} opacity={0.25} />}
      <Circle cx={3} cy={4} r={2.6} fill={BALL} />
    </Svg>
  );
}

export default memo(Flag);
