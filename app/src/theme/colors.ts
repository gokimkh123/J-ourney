// 앱 전체 색. 화면·컴포넌트는 hex를 직접 쓰지 않고 여기 이름만 쓴다.
// 구성원 색은 서버·가짜 서버가 쓰는 lib/theme.ts의 memberColors를 그대로 가져온다(한 곳에서만 정의).
import { memberColors } from '../lib/theme.ts';

export { memberColors };

export const colors = {
  // 바탕 → 패널 → 행 순서로 한 단계씩 밝아진다.
  background: '#0b0d16',
  surface: '#141828',
  surfaceRaised: '#1c2136',
  surfaceSunken: '#0f1220',
  border: '#2a3050',

  text: '#eceef8',
  textMuted: '#98a1bd',
  textOnColor: '#ffffff',

  // 포인트(보라)
  accent: '#a78bfa',
  onAccent: '#1a1233',
  accentSoft: '#2a2250',
  accentSoftText: '#d9ccff',

  // 상태
  success: '#5be0a0',
  warning: '#ffcc4d',
  danger: '#ff7a8a',
  warningSurface: '#3a2f12',
  warningBorder: '#6b5518',
  warningText: '#ffe29a',
  dangerSurface: '#3a1820',
  dangerBorder: '#6b2a36',

  // 말풍선(지도 위)은 밝은 바탕에 어두운 글자
  bubble: '#ffffff',
  onBubble: '#231d36',

  // 지도
  mapSea: '#101528',
  mapGrid: '#1a2038',
  mapLand: '#1c2340',
  mapLandEdge: '#2c3560',

  scrim: 'rgba(5, 6, 12, 0.6)',
} as const;

export type ColorName = keyof typeof colors;

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

// 상태 라벨·배너가 공통으로 쓰는 색 짝
export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: colors.textMuted, bg: colors.surfaceRaised, border: colors.border },
  accent: { fg: colors.accent, bg: colors.accentSoft, border: colors.accent },
  success: { fg: colors.success, bg: colors.surfaceRaised, border: colors.border },
  warning: { fg: colors.warning, bg: colors.warningSurface, border: colors.warningBorder },
  danger: { fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder },
};
