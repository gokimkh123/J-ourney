export type XY = { x: number; y: number };

/**
 * 가까이 붙은 점들을 서로 minDist 이상 떨어지게 밀어 낸다(화면 좌표). 입력 순서를 그대로 지키고 입력은 바꾸지 않는다.
 * 같은 자리에 겹친 점은 순서대로 가로로 벌린다. 몇 번 반복하다 더 밀 게 없으면 멈춘다.
 */
export function spreadPoints(points: readonly XY[], minDist: number, maxRounds = 24): XY[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  if (!(minDist > 0)) return out;
  for (let round = 0; round < maxRounds; round++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist - 1e-6) continue;
        if (d < 1e-6) {
          dx = j - i;
          dy = 0;
          d = Math.abs(dx);
        }
        const push = (minDist - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
