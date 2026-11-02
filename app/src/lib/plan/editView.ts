import type { RouteDay, RouteStop } from '../meeting/types.ts';
import type { MemberRef } from '../meeting/view.ts';
import type { EditOptions, EditResult, PlanBoard } from './board.ts';
import type { PlanEdit } from './planEdit.ts';

/**
 * A·B가 정해진 뒤 일정 탭에서 누구나 바로 고친다(11/1 결정: 바로 반영 + 기록, 확정 투표 없음).
 * 서버는 고른 안을 고치는 동안 상태가 revising이다. 고치기에서 날짜는 route 배열의 순번(0부터)이다.
 */
export function canEdit(board: PlanBoard | null): boolean {
  return board !== null && board.status === 'revising' && board.plan !== null;
}

function locate(route: RouteDay[], itemId: string): { stop: RouteStop; dayIndex: number } | null {
  for (let d = 0; d < route.length; d += 1) {
    const stop = route[d]!.stops.find((s) => s.itemId === itemId);
    if (stop !== undefined) return { stop, dayIndex: d };
  }
  return null;
}

/** 날짜 번호(1일차의 1) → 고치기에 보낼 순번. 없으면 -1 */
export function dayIndexOf(route: RouteDay[], day: number): number {
  return route.findIndex((d) => d.day === day);
}

export type StopActions =
  | { kind: 'sight'; dayIndex: number; canUp: boolean; canDown: boolean; otherDays: { index: number; label: string }[] }
  | { kind: 'meal'; dayIndex: number; mealLabel: string }
  | { kind: 'none' };

/** 일정 한 줄의 ⋯에서 할 수 있는 일. 숙소는 고칠 수 없고, 순서는 그날 관광지끼리만 바꾼다. */
export function stopActions(route: RouteDay[], itemId: string): StopActions {
  const found = locate(route, itemId);
  if (found === null) return { kind: 'none' };
  const { stop, dayIndex } = found;
  if (stop.kind === 'food' && (stop.meal === 'lunch' || stop.meal === 'dinner')) {
    return { kind: 'meal', dayIndex, mealLabel: stop.meal === 'lunch' ? '점심' : '저녁' };
  }
  if (stop.kind !== undefined && stop.kind !== 'sight') return { kind: 'none' };
  const sights = sightIds(route[dayIndex]!);
  const at = sights.indexOf(itemId);
  return {
    kind: 'sight',
    dayIndex,
    canUp: at > 0,
    canDown: at >= 0 && at < sights.length - 1,
    otherDays: route.map((d, index) => ({ index, label: `${d.day}일차` })).filter((d) => d.index !== dayIndex),
  };
}

function sightIds(day: RouteDay): string[] {
  return day.stops.filter((s) => s.kind === undefined || s.kind === 'sight').map((s) => s.itemId);
}

/** 관광지를 그날 관광지 사이에서 한 칸 위·아래로. 서버는 그날 관광지 전부의 새 순서를 받는다. 끝이면 null */
export function reorderEdit(route: RouteDay[], itemId: string, dir: 'up' | 'down'): PlanEdit | null {
  const found = locate(route, itemId);
  if (found === null) return null;
  const ids = sightIds(route[found.dayIndex]!);
  const at = ids.indexOf(itemId);
  const to = dir === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return null;
  [ids[at], ids[to]] = [ids[to]!, ids[at]!];
  return { type: 'reorder', day: found.dayIndex, itemIds: ids };
}

export type AddableSight = { placeId: string; name: string; category: string | null; lat: number; lng: number; likedBy: MemberRef[]; closed: boolean };

/** 그날에 넣을 수 있는 관광지(서버 순서 그대로). 좋아요·꼭 갈 곳으로 고른 사람 얼굴, 그날 쉬면 closed */
export function addableSights(options: EditOptions, dayIndex: number, members: MemberRef[]): AddableSight[] {
  const byId = new Map(members.map((m) => [m.memberId, m]));
  return options.sights.map((s) => {
    const ids = [...new Set([...s.mustFor, ...s.likedBy])];
    return {
      placeId: s.placeId,
      name: s.name,
      category: s.category,
      lat: s.lat,
      lng: s.lng,
      likedBy: ids.map((id) => byId.get(id)).filter((m): m is MemberRef => m !== undefined),
      closed: s.closedDays.includes(dayIndex),
    };
  });
}

/** 끼니 식당을 바꿀 보기와 "동선에서 더 가는 거리" 글. 서버 보기가 없으면 빈 목록(그래도 "아무 데나"는 보낼 수 있다) */
export function mealChoices(options: EditOptions, itemId: string): { placeId: string; name: string; detourLabel: string }[] {
  return (options.meals[itemId] ?? []).map((m) => ({ placeId: m.placeId, name: m.name, detourLabel: `+${m.detourKm.toFixed(1)}km` }));
}

/** 반영하지 못한 건의 서버 문장("반영 못 함: 그날 쉬는 곳"). 다 반영됐으면 빈 목록 */
export function failedNotes(results: EditResult[]): string[] {
  return results.filter((r) => !r.applied).map((r) => r.note);
}

export type HistoryRow = { key: string; who: string; when: string; changes: string[] };

/** "2026-11-04T14:20:00+09:00" → "11/4 14:20". 서버 시각은 한국 시간이라 글자에서 바로 읽는다(기기 시간대와 무관). */
export function whenLabel(at: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  return m === null ? '' : `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}`;
}

/** 고친 기록(새 것부터). 고친 사람이 구성원 목록에 없으면 "누군가". 바뀐 점이 없는 기록은 뺀다. */
export function historyRows(board: PlanBoard, members: MemberRef[]): HistoryRow[] {
  const byId = new Map(members.map((m) => [m.memberId, m.name]));
  return [...board.edits]
    .filter((e) => e.changes.length > 0)
    .sort((a, b) => b.version - a.version)
    .map((e) => ({ key: `v${e.version}`, who: byId.get(e.by) ?? '누군가', when: whenLabel(e.at), changes: e.changes }));
}
