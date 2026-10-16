import type { ReactElement } from "react";
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from "react-native-svg";

import type { CharacterProps, PropKey } from "./props.ts";

// 캐릭터 그림에 쓰는 고정 색. 구성원 색(몸통)은 밖에서 받고, 눈·입·소품 색은 그림의 일부라 여기에 둔다.
// 좌표 원본: docs/app/design-mood/source/beanlib.js (viewBox 0 -4 80 104).
const INK = "#2E2A36";
const CHEEK = "#FF9AA8";
const SHADOW = "rgba(90, 60, 20, 0.13)";
const MOUTH_OPEN = "#6B3A47";
const ZZZ = "#9AA3AE";

export const VIEWBOX_FULL = "0 -4 80 104";
/** 얼굴과 머리 소품만 보이는 둥근 아바타용 잘라 보기 */
export const VIEWBOX_FACE = "6 -3 68 68";
/** 전신 그림의 가로:세로 비율 */
export const FULL_ASPECT = 80 / 104;

const ART: Record<PropKey, ReactElement | null> = {
  cap: (
    <>
      <Path d="M18 27Q19 5 40 5Q61 5 62 27Q40 21 18 27Z" fill="#F4ECDD" stroke="#C8B9A0" strokeWidth={1.8} />
      <Path d="M55 23Q71 20 76 26Q70 31 56 29" fill="#F4ECDD" stroke="#C8B9A0" strokeWidth={1.8} strokeLinejoin="round" />
      <Circle cx={40} cy={5.5} r={2.6} fill="#E3D6BF" stroke="#C8B9A0" strokeWidth={1.2} />
      <Path d="M40 6V24" stroke="#D9CBB2" strokeWidth={1.2} />
    </>
  ),
  beanie: (
    <>
      <Path d="M15 29Q15 3 40 3Q65 3 65 29Z" fill="#B7A6E0" stroke="#8C79C6" strokeWidth={1.8} />
      <Rect x={13} y={22} width={54} height={10} rx={5} fill="#A894D9" stroke="#8C79C6" strokeWidth={1.8} />
      <Path d="M22 23V12M30 22V7M40 22V5M50 22V7M58 23V12" stroke="#9C88D2" strokeWidth={1.4} />
      <Circle cx={40} cy={3} r={5} fill="#C9BCEB" stroke="#8C79C6" strokeWidth={1.6} />
    </>
  ),
  phones: (
    <>
      <Path d="M15 40Q12 4 40 4Q68 4 65 40" fill="none" stroke="#C8B9A0" strokeWidth={7.5} strokeLinecap="round" />
      <Path d="M15 40Q12 4 40 4Q68 4 65 40" fill="none" stroke="#F4ECDD" strokeWidth={4.5} strokeLinecap="round" />
      <Rect x={7} y={31} width={13} height={20} rx={6.5} fill="#F4ECDD" stroke="#C8B9A0" strokeWidth={1.8} />
      <Rect x={60} y={31} width={13} height={20} rx={6.5} fill="#F4ECDD" stroke="#C8B9A0" strokeWidth={1.8} />
    </>
  ),
  bucket: (
    <>
      <Path d="M24 23Q24 6 40 6Q56 6 56 23Z" fill="#F6D776" stroke="#C9A83F" strokeWidth={1.8} />
      <Path d="M11 27Q40 15 69 27Q67 33 40 31Q13 33 11 27Z" fill="#F6D776" stroke="#C9A83F" strokeWidth={1.8} strokeLinejoin="round" />
    </>
  ),
  glasses: (
    <>
      <G fill="rgba(255,255,255,0.25)" stroke={INK} strokeWidth={2}>
        <Circle cx={31.5} cy={41} r={6.8} />
        <Circle cx={48.5} cy={41} r={6.8} />
      </G>
      <Path d="M38.3 41H41.7M24.7 40L20 38.5M55.3 40L60 38.5" stroke={INK} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  // 졸린 눈은 소품이 아니라 눈 모양을 바꾸는 것이라 Bean 안에서 처리한다.
  sleepy: null,
  bag: (
    <>
      <Path d="M62 50L26 72" stroke="#3E9C92" strokeWidth={4} strokeLinecap="round" />
      <Rect x={10} y={66} width={22} height={16} rx={4} fill="#4FB0A5" stroke="#2F7D75" strokeWidth={1.8} />
      <Path d="M10 72H32" stroke="#2F7D75" strokeWidth={1.6} />
      <Circle cx={21} cy={74} r={1.6} fill="#E8F6F3" />
    </>
  ),
  scarf: (
    <>
      <Path d="M22 52Q40 60 58 52L56 57Q40 64 24 57Z" fill="#3E5BA8" stroke="#2C437E" strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M30 58L40 74L50 58Z" fill="#3E5BA8" stroke="#2C437E" strokeWidth={1.6} strokeLinejoin="round" />
      <Circle cx={40} cy={59} r={3} fill="#4F6CB8" stroke="#2C437E" strokeWidth={1.4} />
    </>
  ),
  clover: (
    <>
      <Circle cx={48} cy={64} r={7.5} fill="#FFFFFF" stroke="#9FC79A" strokeWidth={1.8} />
      <G fill="#7DBB75">
        <Circle cx={48} cy={61} r={2.4} />
        <Circle cx={45} cy={64} r={2.4} />
        <Circle cx={51} cy={64} r={2.4} />
        <Circle cx={48} cy={67} r={2.4} />
      </G>
    </>
  ),
  camera: (
    <>
      <Rect x={58} y={51} width={20} height={14} rx={3.5} fill="#5B84D1" stroke="#3B5E9F" strokeWidth={1.8} />
      <Rect x={62} y={48} width={7} height={4} rx={1.4} fill="#5B84D1" stroke="#3B5E9F" strokeWidth={1.4} />
      <Circle cx={68} cy={58} r={4.4} fill="#2D3550" stroke="#DDE6F7" strokeWidth={1.6} />
    </>
  ),
  compass: (
    <>
      <Circle cx={69} cy={59} r={9} fill="#F6D776" stroke="#C9A83F" strokeWidth={1.8} />
      <Circle cx={69} cy={59} r={6} fill="#FFFFFF" />
      <Path d="M69 54L71 59L69 64L67 59Z" fill="#E36A5D" />
      <Path d="M69 59L71 59L69 64L67 59Z" fill="#5B84D1" />
      <Circle cx={69} cy={48.5} r={2.2} fill="none" stroke="#C9A83F" strokeWidth={1.6} />
    </>
  ),
  book: (
    <G transform="rotate(10 68 58)">
      <Rect x={61} y={47} width={14} height={19} rx={2} fill="#2F4A86" stroke="#22365F" strokeWidth={1.8} />
      <Path d="M64 47V66" stroke="#4F6CB8" strokeWidth={1.6} />
    </G>
  ),
  plane: (
    <>
      <Path d="M58 54L80 44L70 64L67 56Z" fill="#FFFFFF" stroke="#AEB7C2" strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M67 56L80 44" stroke="#AEB7C2" strokeWidth={1.4} />
      <Path d="M50 60q4-4 6-2" stroke="#C9D1DA" strokeWidth={1.4} fill="none" strokeDasharray="2 2" />
    </>
  ),
};

export type BeanProps = {
  /** 몸통 바탕(파스텔) */
  body: string;
  /** 외곽선 */
  line: string;
  props: CharacterProps;
  /** 말하는 중이면 입을 벌린다. */
  open?: boolean;
  /** 'full' 전신, 'head' 얼굴과 머리·얼굴 소품만(둥근 아바타용) */
  parts?: "full" | "head";
};

/** 말랑이 한 마리. 그리는 순서: 그림자 → 발 → 왼팔 → 몸 → 볼 → 눈·입 → 몸통 소품 → 오른팔 → 손 소품 → 얼굴 소품 → 머리 소품 */
export function Bean({ body, line, props, open = false, parts = "full" }: BeanProps) {
  const full = parts === "full";
  const holding = props.hand !== undefined;
  const sleepy = props.face === "sleepy";

  return (
    <>
      {full && (
        <>
          <Ellipse cx={40} cy={95} rx={20} ry={3.6} fill={SHADOW} />
          <Ellipse cx={31} cy={89} rx={7.5} ry={5} fill={body} stroke={line} strokeWidth={1.8} />
          <Ellipse cx={49} cy={89} rx={7.5} ry={5} fill={body} stroke={line} strokeWidth={1.8} />
          <Ellipse cx={12} cy={62} rx={5} ry={8.5} transform="rotate(12 12 62)" fill={body} stroke={line} strokeWidth={1.8} />
        </>
      )}
      <Path
        d="M40 12C59 12 66 26 66 45C66 62 67 76 62 84C58 90 22 90 18 84C13 76 14 62 14 45C14 26 21 12 40 12Z"
        fill={body}
        stroke={line}
        strokeWidth={1.8}
      />
      <Ellipse cx={23} cy={49} rx={3.6} ry={2.2} fill={CHEEK} opacity={0.45} />
      <Ellipse cx={57} cy={49} rx={3.6} ry={2.2} fill={CHEEK} opacity={0.45} />
      {sleepy ? (
        <>
          <Path d="M28 41q3.5 3 7 0M45 41q3.5 3 7 0" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
          <SvgText x={62} y={20} fontWeight="700" fontSize={10} fill={ZZZ}>
            z
          </SvgText>
          <SvgText x={68} y={12} fontWeight="700" fontSize={8} fill={ZZZ}>
            z
          </SvgText>
        </>
      ) : (
        <>
          <Ellipse cx={31.5} cy={41} rx={2.7} ry={3.5} fill={INK} />
          <Ellipse cx={48.5} cy={41} rx={2.7} ry={3.5} fill={INK} />
          <Circle cx={32.4} cy={39.7} r={0.9} fill="#FFFFFF" />
          <Circle cx={49.4} cy={39.7} r={0.9} fill="#FFFFFF" />
        </>
      )}
      {open ? (
        <Path d="M36.5 47.5Q40 54 43.5 47.5Z" fill={MOUTH_OPEN} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      ) : (
        <Path d="M37 48q3 2.8 6 0" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      )}
      {full && props.body !== undefined && ART[props.body]}
      {full &&
        (holding ? (
          <Ellipse cx={68} cy={60} rx={5.5} ry={7.5} transform="rotate(-35 68 60)" fill={body} stroke={line} strokeWidth={1.8} />
        ) : (
          <Ellipse cx={68} cy={62} rx={5} ry={8.5} transform="rotate(-12 68 62)" fill={body} stroke={line} strokeWidth={1.8} />
        ))}
      {full && props.hand !== undefined && ART[props.hand]}
      {props.face !== undefined && ART[props.face]}
      {props.head !== undefined && ART[props.head]}
    </>
  );
}

export type CharacterSvgProps = BeanProps & {
  width: number;
  height: number;
  viewBox?: string;
};

/** Bean을 Svg 상자에 담는다. */
export function CharacterSvg({ width, height, viewBox = VIEWBOX_FULL, ...bean }: CharacterSvgProps) {
  return (
    <Svg width={width} height={height} viewBox={viewBox}>
      <Bean {...bean} />
    </Svg>
  );
}
