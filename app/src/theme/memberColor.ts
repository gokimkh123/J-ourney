// 구성원 색(서버가 주는 진한 색) → 캐릭터용 파스텔·외곽선 색. react 의존 없는 순수 함수.

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let s = 0;
  let h = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** 몸통 바탕색: 채도를 낮추고 밝기를 올린다. 잘못된 hex면 입력 그대로. */
export function pastel(hex: string): string {
  if (!HEX.test(hex)) return hex;
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(s, 0.9) * 0.82, 0.77);
}

/** 외곽선 색: 같은 색상에서 탁하고 중간 밝기. 잘못된 hex면 입력 그대로. */
export function outline(hex: string): string {
  if (!HEX.test(hex)) return hex;
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(s, 0.85) * 0.45, 0.5);
}

/** 둥근 얼굴 아바타의 바탕: 밝은 모드는 몸통보다 옅게, 다크 모드는 진하게. */
export function backdrop(hex: string, scheme: 'light' | 'dark'): string {
  if (!HEX.test(hex)) return hex;
  const [h, s] = hexToHsl(hex);
  return scheme === 'dark'
    ? hslToHex(h, Math.min(s, 0.9) * 0.4, 0.28)
    : hslToHex(h, Math.min(s, 0.9) * 0.6, 0.92);
}
