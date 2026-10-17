// 부산 그림 지도 색. 낮(밝은 모드)과 밤(다크 모드) 두 벌.
export type MapArtPalette = {
  sea: string;
  wave: string;
  landShadow: string;
  land: string;
  hill1: string;
  hill2: string;
  snow: string;
  road: string;
  leaf: string;
  leafHi: string;
  trunk: string;
  steam: string;
  bridge: string;
  trailUnder: string;
  trail: string;
  label: string;
  labelStroke: string;
  shadow: string;
  window: string;
  boat: string;
  sail: string;
  /** 밤이면 별빛·불빛·조명을 더 그린다. */
  night: boolean;
  // 밤에만 쓰는 빛
  star: string;
  townLight: string;
  bridgeLight: string;
  bridgeArch: string;
  lighthouseLight: string;
};

const NIGHT_LIGHTS = {
  star: '#FFE7A8',
  townLight: '#FFD98A',
  bridgeLight: '#FFE29A',
  bridgeArch: '#B9A4FF',
  lighthouseLight: '#FFE7A8',
};

export const mapArtPalettes: Record<'light' | 'dark', MapArtPalette> = {
  light: {
    sea: '#BFE4F2',
    wave: '#FFFFFF',
    landShadow: '#E7CF9E',
    land: '#FFF3D6',
    hill1: '#BFE3A6',
    hill2: '#A8D98C',
    snow: '#FFFFFF',
    road: '#F0DDB3',
    leaf: '#8FD07A',
    leafHi: '#B4E3A1',
    trunk: '#C59A62',
    steam: '#FFFFFF',
    bridge: '#FFFFFF',
    trailUnder: '#D9BC86',
    trail: '#FFFFFF',
    label: '#A88A5C',
    labelStroke: '#FFF7E6',
    shadow: 'rgba(90,60,20,0.2)',
    window: '#FFFFFF',
    boat: '#FFFFFF',
    sail: '#FF8FA3',
    night: false,
    ...NIGHT_LIGHTS,
  },
  dark: {
    sea: '#13223A',
    wave: '#2A4468',
    landShadow: '#17141F',
    land: '#2B2840',
    hill1: '#2C4537',
    hill2: '#355241',
    snow: '#5B7A68',
    road: '#38334F',
    leaf: '#3D6A50',
    leafHi: '#4F8063',
    trunk: '#5A4A3A',
    steam: '#8A8DB4',
    bridge: '#4A4F70',
    trailUnder: '#18151F',
    trail: '#FFE29A',
    label: '#BBAEDB',
    labelStroke: '#2B2840',
    shadow: 'rgba(0,0,0,0.4)',
    window: '#FFD98A',
    boat: '#C9CDD2',
    sail: '#FF8FA3',
    night: true,
    ...NIGHT_LIGHTS,
  },
};
