// 움직임은 캐릭터 이동·핀 등장·시트 전환 정도에만 쓴다. 시간은 ms.
export const duration = {
  fast: 150, // 눌림
  normal: 250, // 나타남·사라짐
  slow: 450, // 핀 등장
  travel: 1100, // 지도 위 캐릭터 이동
} as const;

// Reanimated Easing.bezier 인자로 쓴다.
export const easing = {
  standard: [0.2, 0, 0, 1],
  travel: [0.5, 0.1, 0.2, 1],
} as const;

export const pressedOpacity = 0.75;
export const disabledOpacity = 0.4;
