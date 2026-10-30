import type { TextStyle } from 'react-native';

// 글꼴. 시안은 제목 Jua, 본문 Noto Sans KR이다.
// 폰트 번들이 정해지면 여기 두 값만 바꾼다(예: display: 'Jua_400Regular'). undefined면 시스템 글꼴.
export const fontFamily: { display: string | undefined; body: string | undefined } = {
  display: undefined,
  body: undefined,
};

// 시스템 글꼴일 때 제목이 너무 가볍지 않도록 굵기를 올린다. Jua를 넣으면 '400'으로 바꾼다.
const displayWeight: TextStyle['fontWeight'] = fontFamily.display === undefined ? '700' : '400';

function style(s: TextStyle): TextStyle {
  return s;
}

// 이름 붙은 글자 스타일. 화면에서 fontSize를 직접 쓰지 않는다.
export const typography = {
  // 화면 대표 숫자·결론 한 줄 (예: "합의 완료"). 제목 쪽(display·title·statNumber·heading)은 자간을 살짝 좁힌다.
  display: style({ fontFamily: fontFamily.display, fontWeight: displayWeight, fontSize: 28, lineHeight: 36, letterSpacing: -0.5 }),
  // 화면 제목, 캐릭터 이름
  title: style({ fontFamily: fontFamily.display, fontWeight: displayWeight, fontSize: 22, lineHeight: 30, letterSpacing: -0.3 }),
  // 카드·구역 제목. bodyStrong(15)보다 2 커서 제목으로 읽힌다.
  heading: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 17, lineHeight: 24, letterSpacing: -0.2 }),
  body: style({ fontFamily: fontFamily.body, fontWeight: '400', fontSize: 15, lineHeight: 22 }),
  bodyStrong: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 15, lineHeight: 22 }),
  small: style({ fontFamily: fontFamily.body, fontWeight: '400', fontSize: 13, lineHeight: 19 }),
  smallStrong: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 13, lineHeight: 19 }),
  caption: style({ fontFamily: fontFamily.body, fontWeight: '400', fontSize: 12, lineHeight: 16 }),
  // 버튼·라벨·상태 글자
  label: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 12, lineHeight: 16 }),
  // 지도 핀 머리 숫자처럼 아주 좁은 자리
  micro: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 10, lineHeight: 12 }),
  button: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 15, lineHeight: 20 }),
  // 시간·금액처럼 자리가 맞아야 하는 숫자
  numeric: style({ fontFamily: fontFamily.body, fontWeight: '700', fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] }),
  statNumber: style({ fontFamily: fontFamily.display, fontWeight: displayWeight, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, fontVariant: ['tabular-nums'] }),
} as const;

export type TypographyVariant = keyof typeof typography;
