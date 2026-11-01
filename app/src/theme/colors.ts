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
  /** danger 바탕 위 글자(다크 모드에서는 짙은 글자) */
  onDanger: string;
  /** 구성원 색 위 글자(후보 번호). 흰 글자는 대비가 모자라 짙은 글자를 쓴다. */
  onMember: string;
  /** 켜지지 않은 탭 아이콘처럼 textMuted보다 더 옅게 둘 선·아이콘 색 */
  iconFaint: string;

  // 메인 색(콘플라워). accent는 칠하는 데만 쓰고, 메인 색 글자는 accentSoftText를 쓴다(크림 바탕 위 accent 글자는 4.3:1).
  accent: string;
  onAccent: string;
  accentSoft: string;
  accentSoftText: string;

  // 준비 화면처럼 메인 색을 바탕으로 깔 때. 다크에서 accent는 너무 밝아 바탕용을 따로 둔다.
  hero: string;
  /** 메인 색 바탕 위 캐릭터 발밑 그림자 */
  heroFloor: string;
  /** 메인 색 바탕 위 글자·글자 그림 */
  onHero: string;

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
  /** 캐릭터가 서는 무대(mapLand 바탕)의 바닥 타원 */
  stageFloor: string;

  scrim: string;
};

// 개편 기록(디자인 시스템 proposal.md): 크림 바탕 + 메인 색 콘플라워. 글자 짝은 모두 4.5:1 이상.
export const lightColors: ThemeColors = {
  background: '#FBF8F3',
  surface: '#FFFFFF',
  surfaceRaised: '#F3EEE6',
  surfaceSunken: '#F8F4EE',
  border: '#E6DFD3',

  text: '#211D18',
  textMuted: '#6F665A',
  textBody: '#453E35',
  textOnColor: '#FFFFFF',
  onDanger: '#FFFFFF',
  onMember: '#191F28',
  iconFaint: '#948A7C',

  accent: '#5762FF',
  onAccent: '#FFFFFF',
  accentSoft: '#EAECFD',
  accentSoftText: '#3B45CE',

  hero: '#5762FF',
  heroFloor: '#3B45CE',
  onHero: '#FFFFFF',

  success: '#0F7A45',
  warning: '#945400',
  danger: '#CC2A3B',
  warningSurface: '#FFF3D9',
  warningBorder: '#F5D58A',
  warningText: '#734C00',
  dangerSurface: '#FDECEC',
  dangerBorder: '#F2B8BD',

  bubble: '#FFFFFF',
  onBubble: '#211D18',

  mapSea: '#BFE4F2',
  mapLand: '#FFF3D6',
  mapLandEdge: '#E7CF9E',
  mapGrid: '#F0DDB3',
  stageFloor: '#F5E2B8',

  scrim: 'rgba(0, 0, 0, 0.4)',
};

export const darkColors: ThemeColors = {
  background: '#13141B',
  surface: '#1C1E28',
  surfaceRaised: '#282B37',
  surfaceSunken: '#181A22',
  border: '#3A3E4D',

  text: '#F1F0EC',
  textMuted: '#9A98A6',
  textBody: '#CDCAC3',
  textOnColor: '#FFFFFF',
  onDanger: '#13141B',
  onMember: '#191F28',
  iconFaint: '#7D7B8C',

  accent: '#949BFF',
  onAccent: '#13141B',
  accentSoft: '#252846',
  accentSoftText: '#949BFF',

  hero: '#3B45CE',
  heroFloor: '#2A3190',
  onHero: '#FFFFFF',

  success: '#4CD68A',
  warning: '#FFC75A',
  danger: '#FF7A85',
  warningSurface: '#3A2F14',
  warningBorder: '#6B5518',
  warningText: '#FFE3A3',
  dangerSurface: '#3D1D25',
  dangerBorder: '#6E2E3B',

  bubble: '#282B37',
  onBubble: '#F1F0EC',

  mapSea: '#13223A',
  mapLand: '#2B2840',
  mapLandEdge: '#17141F',
  mapGrid: '#38334F',
  stageFloor: '#363250',

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

// 상태는 색만으로 알리지 않는다. 다크 모드에서 상태색과 구성원 색의 밝기가 비슷해서 글자 앞에 기호를 붙인다.
const TONE_GLYPH: Partial<Record<Tone, string>> = { success: '✓', warning: '!', danger: '✕' };

/** "완료" → "✓ 완료". neutral·accent는 그대로. */
export function withToneGlyph(tone: Tone, label: string): string {
  const glyph = TONE_GLYPH[tone];
  return glyph === undefined ? label : `${glyph} ${label}`;
}
