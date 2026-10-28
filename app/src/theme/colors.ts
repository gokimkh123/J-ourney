// 앱 전체 색. 화면·컴포넌트는 hex를 직접 쓰지 않고 여기 이름만 쓴다.
// 밝은·다크 두 벌이 같은 키를 가진다. 컴포넌트는 useTheme()로 지금 모드의 색을 받는다.
// 구성원 색은 서버·가짜 서버가 쓰는 lib/theme.ts의 memberColors를 그대로 가져온다(한 곳에서만 정의).
import { memberColors } from '../lib/theme.ts';

export { memberColors };

export type ThemeColors = {
  // 바탕 → 패널 → 행 순서로 구분된다.
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;

  text: string;
  textMuted: string;
  textBody: string;
  textOnColor: string;
  /** 켜지지 않은 탭 아이콘처럼 textMuted보다 더 옅게 둘 선·아이콘 색 */
  iconFaint: string;

  // 주요 버튼 바탕(검정/흰색). 색은 구성원 색만 쓴다.
  accent: string;
  onAccent: string;
  accentSoft: string;
  accentSoftText: string;

  // 상태
  success: string;
  warning: string;
  danger: string;
  warningSurface: string;
  warningBorder: string;
  warningText: string;
  dangerSurface: string;
  dangerBorder: string;

  // 말풍선(지도 위)
  bubble: string;
  onBubble: string;

  // 지도
  mapSea: string;
  mapLand: string;
  mapLandEdge: string;
  mapGrid: string;

  scrim: string;
};

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#F2F4F6',
  surfaceSunken: '#F7F8FA',
  border: '#E5E8EB',

  text: '#191F28',
  textMuted: '#667080',
  textBody: '#333D4B',
  textOnColor: '#FFFFFF',
  iconFaint: '#B0B8C1',

  accent: '#191F28',
  onAccent: '#FFFFFF',
  accentSoft: '#EEF0F3',
  accentSoftText: '#191F28',

  success: '#22C55E',
  warning: '#F5A524',
  danger: '#F04452',
  warningSurface: '#FFF6E0',
  warningBorder: '#F5D58A',
  warningText: '#7A5200',
  dangerSurface: '#FFECEE',
  dangerBorder: '#F7B5BC',

  bubble: '#FFFFFF',
  onBubble: '#191F28',

  mapSea: '#BFE4F2',
  mapLand: '#FFF3D6',
  mapLandEdge: '#E7CF9E',
  mapGrid: '#F0DDB3',

  scrim: 'rgba(0, 0, 0, 0.4)',
};

export const darkColors: ThemeColors = {
  background: '#17181C',
  surface: '#1F2026',
  surfaceRaised: '#26272D',
  surfaceSunken: '#1B1C21',
  border: '#33343B',

  text: '#F2F4F6',
  textMuted: '#8B95A1',
  textBody: '#C9CDD2',
  textOnColor: '#FFFFFF',
  iconFaint: '#6B7684',

  accent: '#F2F4F6',
  onAccent: '#17181C',
  accentSoft: '#33343B',
  accentSoftText: '#F2F4F6',

  success: '#34D27B',
  warning: '#FFC24D',
  danger: '#FF6B78',
  warningSurface: '#3A2F12',
  warningBorder: '#6B5518',
  warningText: '#FFE29A',
  dangerSurface: '#3A1820',
  dangerBorder: '#6B2A36',

  bubble: '#2A2B33',
  onBubble: '#F2F4F6',

  mapSea: '#13223A',
  mapLand: '#2B2840',
  mapLandEdge: '#17141F',
  mapGrid: '#38334F',

  scrim: 'rgba(0, 0, 0, 0.6)',
};

/** 호환용 별칭(밝은 모드). 새 코드는 useTheme().colors를 쓴다. */
export const colors = lightColors;

export type ColorName = keyof ThemeColors;

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export type ToneColors = Record<Tone, { fg: string; bg: string; border: string }>;

// 상태 라벨·배너가 공통으로 쓰는 색 짝(모드별)
export function makeToneColors(c: ThemeColors): ToneColors {
  return {
    neutral: { fg: c.textMuted, bg: c.surfaceRaised, border: c.border },
    accent: { fg: c.accentSoftText, bg: c.accentSoft, border: c.accent },
    success: { fg: c.success, bg: c.surfaceRaised, border: c.border },
    warning: { fg: c.warning, bg: c.warningSurface, border: c.warningBorder },
    danger: { fg: c.danger, bg: c.dangerSurface, border: c.dangerBorder },
  };
}

/** 호환용 별칭(밝은 모드). */
export const toneColors: ToneColors = makeToneColors(lightColors);
