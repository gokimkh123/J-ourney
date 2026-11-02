import type { RouteDay, RouteStop } from '../meeting/types.ts';
import type { PlanEdit } from './planEdit.ts';

/**
 * 일정 탭에서 처음 고친 때부터 "수정 확정"까지 이 폰에만 쌓아 두는 초안. 순수 함수만 있다.
 * 모든 함수는 초안을 바꾸지 않고 새 초안을 돌려주며, 할 수 없는 조작이면 받은 초안을 그대로 돌려준다.
 */
export type AddedSight = {
  key: string;
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  dayIndex: number;
};

/** placeId·name이 모두 null이면 "아무 데나"(서버가 고름) */
export type MealSwap = { placeId: string | null; name: string | null };

export type PlanDraft = {
  baseVersion: number;
  /** 처음 고칠 때의 원래 일정(바꾸지 않음) */
  route: RouteDay[];
  /** 뺄 원래 관광지 itemId */
  removed: string[];
  /** 원래 관광지 itemId → 옮길 날 순번 */
  moved: Record<string, number>;
  /** 날 순번 → 그날 원래 관광지 itemId 전체(뺀 곳·옮겨 나간 곳 포함)의 새 순서 */
  order: Record<number, string[]>;
  /** 식당 itemId → 바꿀 식당 */
  meals: Record<string, MealSwap>;
  added: AddedSight[];
};

export type DraftMark = 'removed' | 'moved' | 'reordered' | 'swapped' | 'added' | null;

export type DraftRow = {
  key: string;
  dayIndex: number;
  name: string;
  kind: 'sight' | 'food' | 'lodging';
  meal: 'lunch' | 'dinner' | null;
  mark: DraftMark;
  stop: RouteStop | null;
  added: AddedSight | null;
  originalName: string | null;
  canUp: boolean;
  canDown: boolean;
  canMove: boolean;
  canRemove: boolean;
  canSwap: boolean;
  canRestore: boolean;
};

type Flags = Pick<DraftRow, 'canUp' | 'canDown' | 'canMove' | 'canRemove' | 'canSwap' | 'canRestore'>;

const NONE: Flags = { canUp: false, canDown: false, canMove: false, canRemove: false, canSwap: false, canRestore: false };

function kindOf(stop: RouteStop): 'sight' | 'food' | 'lodging' {
  return stop.kind ?? 'sight';
}

function isSight(stop: RouteStop): boolean {
  return kindOf(stop) === 'sight';
}

function isMeal(stop: RouteStop): boolean {
  return kindOf(stop) === 'food' && (stop.meal === 'lunch' || stop.meal === 'dinner');
}

function inRange(d: PlanDraft, dayIndex: number): boolean {
  return Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < d.route.length;
}

function findStop(d: PlanDraft, itemId: string): { stop: RouteStop; dayIndex: number } | null {
  for (const [dayIndex, day] of d.route.entries()) {
    const stop = day.stops.find((s) => s.itemId === itemId);
    if (stop !== undefined) return { stop, dayIndex };
  }
  return null;
}

function findSight(d: PlanDraft, itemId: string): { stop: RouteStop; dayIndex: number } | null {
  const found = findStop(d, itemId);
  return found !== null && isSight(found.stop) ? found : null;
}

/** 그날 원래 관광지 itemId(원래 순서) */
function sightIds(d: PlanDraft, dayIndex: number): string[] {
  return (d.route[dayIndex]?.stops ?? []).filter(isSight).map((s) => s.itemId);
}

/** 빼지 않고 옮겨 나가지 않은 원래 관광지인가 */
function isLeft(d: PlanDraft, itemId: string): boolean {
  return !d.removed.includes(itemId) && d.moved[itemId] === undefined;
}

/** 순서를 바꾼 날에 보이는 자리가 원래와 다른 남은 원래 관광지인가. 뺀 곳은 자리를 지키고 옮겨 나간 곳은 자리에서 빠진다. */
function isReordered(d: PlanDraft, dayIndex: number, itemId: string): boolean {
  const order = d.order[dayIndex];
  if (order === undefined || !isLeft(d, itemId)) return false;
  const shown = (ids: string[]) => ids.filter((id) => d.moved[id] === undefined);
  return shown(order).indexOf(itemId) !== shown(sightIds(d, dayIndex)).indexOf(itemId);
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0);

export function createDraft(route: RouteDay[], baseVersion: number): PlanDraft {
  return { baseVersion, route, removed: [], moved: {}, order: {}, meals: {}, added: [] };
}

/** 원래 관광지는 빼고(옮겨 간 곳이면 옮기기도 취소), 넣은 곳은 지운다. 식당·숙소는 뺄 수 없다. */
export function removeRow(d: PlanDraft, key: string): PlanDraft {
  if (d.added.some((a) => a.key === key)) return { ...d, added: d.added.filter((a) => a.key !== key) };
  if (findSight(d, key) === null || d.removed.includes(key)) return d;
  return { ...d, removed: [...d.removed, key], moved: omit(d.moved, key) };
}

/** 그 줄의 바꿈을 되돌린다. 순서만 바뀐 곳이면 그날 순서 전체를 되돌린다. */
export function restoreRow(d: PlanDraft, key: string): PlanDraft {
  if (d.removed.includes(key)) return { ...d, removed: d.removed.filter((id) => id !== key) };
  if (d.moved[key] !== undefined) return { ...d, moved: omit(d.moved, key) };
  if (d.meals[key] !== undefined) return { ...d, meals: omit(d.meals, key) };
  if (d.added.some((a) => a.key === key)) return { ...d, added: d.added.filter((a) => a.key !== key) };
  const found = findSight(d, key);
  if (found === null || !isReordered(d, found.dayIndex, key)) return d;
  const order = { ...d.order };
  delete order[found.dayIndex];
  return { ...d, order };
}

/** 다른 날로 옮긴다. 원래 날로 옮기면 제자리로 돌아간다. */
export function moveRow(d: PlanDraft, key: string, dayIndex: number): PlanDraft {
  if (!inRange(d, dayIndex)) return d;
  const added = d.added.find((a) => a.key === key);
  if (added !== undefined) {
    if (added.dayIndex === dayIndex) return d;
    return { ...d, added: d.added.map((a) => (a === added ? { ...a, dayIndex } : a)) };
  }
  const found = findSight(d, key);
  if (found === null || d.removed.includes(key) || (d.moved[key] ?? found.dayIndex) === dayIndex) return d;
  const moved = omit(d.moved, key);
  if (dayIndex !== found.dayIndex) moved[key] = dayIndex;
  return { ...d, moved };
}

/** 그날 남은 원래 관광지 사이에서 한 칸 위·아래로. 뺀 곳·옮겨 나간 곳의 자리는 그대로 둔다. */
export function shiftRow(d: PlanDraft, key: string, dir: 'up' | 'down'): PlanDraft {
  const found = findSight(d, key);
  if (found === null || !isLeft(d, key)) return d;
  const original = sightIds(d, found.dayIndex);
  const base = d.order[found.dayIndex] ?? original;
  const left = base.filter((id) => isLeft(d, id));
  const i = left.indexOf(key);
  const other = left[dir === 'up' ? i - 1 : i + 1];
  if (other === undefined) return d;
  const next = base.map((id) => (id === key ? other : id === other ? key : id));
  const order = { ...d.order };
  if (next.every((id, k) => id === original[k])) delete order[found.dayIndex];
  else order[found.dayIndex] = next;
  return { ...d, order };
}

/** 관광지를 넣는다. 이미 있으면 그대로, 원래 일정에서 뺀 곳이면 빼기를 되돌린다. */
export function addSight(
  d: PlanDraft,
  place: Pick<AddedSight, 'placeId' | 'name' | 'lat' | 'lng' | 'category'>,
  dayIndex: number,
): PlanDraft {
  if (!inRange(d, dayIndex) || d.added.some((a) => a.placeId === place.placeId)) return d;
  const same = d.route.flatMap((day) => day.stops).filter((s) => s.placeId === place.placeId);
  if (same.some((s) => !d.removed.includes(s.itemId))) return d;
  if (same.length > 0) return { ...d, removed: d.removed.filter((id) => !same.some((s) => s.itemId === id)) };
  const { placeId, name, lat, lng, category } = place;
  return { ...d, added: [...d.added, { key: 'add:' + placeId, placeId, name, lat, lng, category, dayIndex }] };
}

/** 끼니 식당만 바꿀 수 있다. */
export function swapMeal(d: PlanDraft, itemId: string, swap: MealSwap): PlanDraft {
  const found = findStop(d, itemId);
  if (found === null || !isMeal(found.stop)) return d;
  return { ...d, meals: { ...d.meals, [itemId]: swap } };
}

/** 서버에 보낼 순서: reorder → remove → move → add → meal. reorder가 먼저여야 뒤이은 빼기·옮기기가 고정 순서에 맞게 적용된다. */
export function draftEdits(d: PlanDraft): PlanEdit[] {
  const edits: PlanEdit[] = [];
  const orders = Object.entries(d.order).map(([day, itemIds]) => ({ day: Number(day), itemIds }));
  for (const { day, itemIds } of orders.sort((a, b) => a.day - b.day)) edits.push({ type: 'reorder', day, itemIds });
  for (const itemId of d.removed) edits.push({ type: 'remove', itemId });
  for (const [itemId, day] of Object.entries(d.moved).sort(byKey)) edits.push({ type: 'move', itemId, day });
  for (const a of d.added) edits.push({ type: 'add', placeId: a.placeId, day: a.dayIndex });
  for (const [itemId, swap] of Object.entries(d.meals).sort(byKey)) edits.push({ type: 'meal', itemId, placeId: swap.placeId });
  return edits;
}

export function changeCount(d: PlanDraft): number {
  return draftEdits(d).length;
}

function stopRow(stop: RouteStop, dayIndex: number, mark: DraftMark, flags: Partial<Flags>): DraftRow {
  return {
    key: stop.itemId,
    dayIndex,
    name: stop.name,
    kind: kindOf(stop),
    meal: stop.meal ?? null,
    mark,
    stop,
    added: null,
    originalName: null,
    ...NONE,
    ...flags,
  };
}

/**
 * 그날 보일 줄 목록. 원래 관광지 칸에 보일 관광지를 차례로 채우고(남는 칸은 건너뜀),
 * 마지막 관광지 칸 뒤(없으면 첫 숙소 앞, 그것도 없으면 맨 뒤)에 옮겨 온 곳과 넣은 곳을 붙인다. 식당·숙소는 제자리.
 */
export function draftRows(d: PlanDraft, dayIndex: number): DraftRow[] {
  const stops = d.route[dayIndex]?.stops;
  if (stops === undefined) return [];
  const multiDay = d.route.length > 1;
  const shown = (d.order[dayIndex] ?? sightIds(d, dayIndex)).filter((id) => d.moved[id] === undefined);
  const left = shown.filter((id) => isLeft(d, id));

  const incoming: DraftRow[] = [];
  d.route.forEach((day, from) => {
    if (from === dayIndex) return;
    for (const stop of day.stops) {
      if (d.moved[stop.itemId] === dayIndex) {
        incoming.push(stopRow(stop, dayIndex, 'moved', { canMove: multiDay, canRemove: true, canRestore: true }));
      }
    }
  });
  for (const a of d.added) {
    if (a.dayIndex !== dayIndex) continue;
    incoming.push({
      key: a.key,
      dayIndex,
      name: a.name,
      kind: 'sight',
      meal: null,
      mark: 'added',
      stop: null,
      added: a,
      originalName: null,
      ...NONE,
      canMove: multiDay,
      canRemove: true,
    });
  }

  const lastSight = stops.map(isSight).lastIndexOf(true);
  const firstLodging = stops.findIndex((s) => kindOf(s) === 'lodging');
  const insertAt = lastSight >= 0 ? lastSight + 1 : firstLodging >= 0 ? firstLodging : stops.length;

  const rows: DraftRow[] = [];
  let slot = 0;
  stops.forEach((stop, i) => {
    if (i === insertAt) rows.push(...incoming);
    if (isSight(stop)) {
      const id = shown[slot++];
      const sight = stops.find((s) => s.itemId === id);
      if (sight === undefined) return;
      if (d.removed.includes(sight.itemId)) {
        rows.push(stopRow(sight, dayIndex, 'removed', { canRestore: true }));
        return;
      }
      const r = left.indexOf(sight.itemId);
      const reordered = isReordered(d, dayIndex, sight.itemId);
      rows.push(
        stopRow(sight, dayIndex, reordered ? 'reordered' : null, {
          canUp: r > 0,
          canDown: r < left.length - 1,
          canMove: multiDay,
          canRemove: true,
          canRestore: reordered,
        }),
      );
      return;
    }
    const swap = d.meals[stop.itemId];
    if (swap === undefined) {
      rows.push(stopRow(stop, dayIndex, null, { canSwap: isMeal(stop) }));
    } else {
      rows.push({
        ...stopRow(stop, dayIndex, 'swapped', { canSwap: true, canRestore: true }),
        name: swap.name ?? '아무 데나',
        originalName: stop.name,
      });
    }
  });
  if (insertAt === stops.length) rows.push(...incoming);
  return rows;
}
