// 끌어서 순서 바꾸기 목록(DraggableList)의 자리 계산. react 무관 순수 함수.

export type Box = { y: number; h: number };
export type DragRow = { key: string; draggable: boolean };

/** 끄는 줄의 가운데와 가장 가까운 끌 수 있는 줄(놓일 자리). 자리를 모르면 자기 자신. */
export function dropTarget(rows: readonly DragRow[], boxes: ReadonlyMap<string, Box>, key: string, moved: number): string {
  const from = boxes.get(key);
  if (from === undefined) return key;
  const center = from.y + from.h / 2 + moved;
  let best = key;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const box = boxes.get(row.key);
    if (!row.draggable || box === undefined) continue;
    const gap = Math.abs(box.y + box.h / 2 - center);
    if (gap < bestGap) {
      bestGap = gap;
      best = row.key;
    }
  }
  return best;
}

/** fromKey를 toKey 자리로 옮긴 뒤의 줄 순서. 끌 수 있는 줄끼리만 자리를 바꾸고 다른 줄은 제자리. */
export function reorderedKeys(rows: readonly DragRow[], fromKey: string, toKey: string): string[] {
  const movable = rows.filter((r) => r.draggable).map((r) => r.key);
  const from = movable.indexOf(fromKey);
  const to = movable.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return rows.map((r) => r.key);
  movable.splice(from, 1);
  movable.splice(to, 0, fromKey);
  let k = 0;
  return rows.map((r) => (r.draggable ? movable[k++]! : r.key));
}

/**
 * 옮긴 뒤 순서대로 줄을 다시 쌓았을 때 줄마다 지금 자리에서 움직일 거리(y, 아래가 +).
 * 줄 사이 간격은 지금 첫 두 줄 사이와 같다고 본다. 자리를 모르는 줄이 있으면 아무것도 움직이지 않는다.
 */
export function shiftsAfter(rows: readonly DragRow[], boxes: ReadonlyMap<string, Box>, fromKey: string, toKey: string): Map<string, number> {
  const shifts = new Map<string, number>();
  if (rows.some((r) => !boxes.has(r.key))) return shifts;
  const first = boxes.get(rows[0]?.key ?? '');
  const second = boxes.get(rows[1]?.key ?? '');
  if (first === undefined) return shifts;
  const gap = second === undefined ? 0 : Math.max(0, second.y - (first.y + first.h));
  let y = first.y;
  for (const key of reorderedKeys(rows, fromKey, toKey)) {
    const box = boxes.get(key)!;
    shifts.set(key, y - box.y);
    y += box.h + gap;
  }
  return shifts;
}

/** 화면 읽기로 한 칸 위(-1)·아래(+1)로 옮길 때 자리를 바꿀 끌 수 있는 이웃 줄. 없으면 null */
export function neighborKey(rows: readonly DragRow[], key: string, dir: -1 | 1): string | null {
  const movable = rows.filter((r) => r.draggable).map((r) => r.key);
  const at = movable.indexOf(key);
  if (at < 0) return null;
  return movable[at + dir] ?? null;
}
