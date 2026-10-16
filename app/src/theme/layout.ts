// 간격은 4pt 단위. 컴포넌트 사이 간격은 margin 대신 gap으로 준다.
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

// 같은 화면 안 모서리는 이 값만 쓴다. 바깥 상자일수록 큰 값.
export const radius = {
  sm: 8, // 작은 태그·입력 안쪽
  md: 12, // 행, 입력칸, 버튼(sm)
  lg: 16, // 카드, 버튼
  xl: 22, // 아래쪽 시트 윗모서리
  full: 999,
} as const;

export const borderWidth = {
  hairline: 1,
  focus: 2,
} as const;

// 눌리는 영역 최소 크기(안드로이드 권장 48dp)
export const hitSize = 48;

// 그림자는 떠 있는 것(시트·말풍선)에만 쓴다.
export const elevation = {
  sheet: '0px -8px 24px rgba(0, 0, 0, 0.35)',
  float: '0px 6px 18px rgba(0, 0, 0, 0.35)',
} as const;

export type Spacing = keyof typeof spacing;
export type Radius = keyof typeof radius;
