import type { PlaceKind } from '../../components/PlaceSticker.tsx';
import type { RouteDay, RouteStop } from '../meeting/types.ts';
import type { MemberRef } from '../meeting/view.ts';
import { createValueStore } from '../store/valueStore.ts';
import { formatWon, moveModeLabel } from '../ui/format.ts';
import { draftRows, type PlanDraft } from './planDraft.ts';
import { placeKindOf } from './placeKind.ts';

/** 사람이 고른 실서버 일정안. 서버 7단계 이후가 오기 전까지 이 폰 안에서만 정하고(앱을 끄면 사라진다), 일정 탭이 읽는다. */
export type ChosenPlan = { planId: string; route: RouteDay[]; members: MemberRef[] };

export const chosenPlanStore = createValueStore<ChosenPlan | null>(null);

export type StopRow = {
  itemId: string;
  /** 앱이 이동 시간을 이어 붙여 짐작한 시각 "09:00" (서버 값 아님) */
  time: string;
  title: string;
  category: string;
  forMembers: { name: string; color: string }[];
  moveLabel?: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  /** 지도 핀 색: 첫 구성원 색, 없으면 fallback */
  color: string;
  /** 사람이 바꾼 시각을 찾는 열쇠(timeKeyOf). 넣은 곳은 장소 id */
  timeKey: string;
};

// 시각 짐작: 하루는 9시에 시작하고, 머무는 시간은 종류별로 고정한다. 점심·저녁은 그 시각 전에는 시작하지 않는다.
const DAY_START = 9 * 60;
const STAY: Record<NonNullable<RouteStop['kind']>, number> = { sight: 90, food: 60, lodging: 30 };
const UNKNOWN_LEG_MINUTES = 15;
const LUNCH_AT = 12 * 60;
const DINNER_AT = 18 * 60;

/** 자정부터 분 → "09:00"(하루 끝을 넘으면 23:59) */
export function clock(minutes: number): string {
  const m = Math.min(minutes, 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 시각을 짐작할 한 칸. legMinutes는 앞 곳에서 오는 이동 시간(모르면 null) */
export type TimeSlot = { key: string; kind: 'sight' | 'food' | 'lodging'; meal: 'lunch' | 'dinner' | null; legMinutes: number | null };

/**
 * 하루 시각 짐작(자정부터 분). 앞 곳에 머무는 시간과 이동 시간을 이어 붙인다.
 * fixed에 있는 곳은 사람이 정한 시각에 시작하고(앞 곳보다 이르게는 못 한다) 뒤 곳은 거기서부터 이어 붙인다.
 */
export function slotMinutes(slots: TimeSlot[], fixed: Record<string, number> = {}): number[] {
  const out: number[] = [];
  let t = DAY_START;
  slots.forEach((slot, i) => {
    if (i > 0) t += STAY[slots[i - 1]!.kind] + (slot.legMinutes ?? UNKNOWN_LEG_MINUTES);
    if (slot.meal === 'lunch') t = Math.max(t, LUNCH_AT);
    if (slot.meal === 'dinner') t = Math.max(t, DINNER_AT);
    const set = fixed[slot.key];
    if (set !== undefined) t = i > 0 ? Math.max(set, out[i - 1]!) : set;
    out.push(t);
  });
  return out;
}

/** 바꾼 시각을 붙일 열쇠: 장소 id(고쳐서 항목 id가 바뀌어도 이어지게). 숙소는 하루에 두 번 나올 수 있어 항목 id */
export function timeKeyOf(stop: RouteStop): string {
  return stop.kind === 'lodging' ? stop.itemId : (stop.placeId ?? stop.itemId);
}

function slotOf(stop: RouteStop): TimeSlot {
  return { key: timeKeyOf(stop), kind: stop.kind ?? 'sight', meal: stop.meal ?? null, legMinutes: stop.moveFromPrev?.minutes ?? null };
}

export function stopTimes(stops: RouteStop[], fixed: Record<string, number> = {}): string[] {
  return slotMinutes(stops.map(slotOf), fixed).map(clock);
}

export function categoryOf(stop: RouteStop): string {
  if (stop.kind === 'lodging') return '숙소';
  if (stop.kind === 'food') return stop.meal === 'lunch' ? '점심' : stop.meal === 'dinner' ? '저녁' : '식사';
  return stop.night === true ? '야경' : '관광';
}

export function stopKindOf(stop: RouteStop): PlaceKind {
  if (stop.kind === 'food') return 'food';
  if (stop.kind === 'lodging') return 'pin';
  return placeKindOf(stop.category ?? '');
}

function moveLabelOf(stop: RouteStop): string | undefined {
  const leg = stop.moveFromPrev;
  if (leg === null || leg === undefined) return undefined;
  const mode = leg.mode === null ? '이동' : moveModeLabel(leg.mode);
  const base = leg.minutes === null ? `직선 ${(leg.distanceM / 1000).toFixed(1)}km` : `${mode} ${leg.minutes}분`;
  if (leg.fareWon === null || leg.fareWon <= 0) return base;
  // 택시는 서버가 요금을 구성원 수로 나눈 1인 몫으로 준다(server schedule.ts taxiPerPersonWon). 대중교통 요금은 원래 1인 요금.
  return leg.mode === 'taxi' ? `${base} · 1인 ${formatWon(leg.fareWon)}` : `${base} · ${formatWon(leg.fareWon)}`;
}

/** 이 사람 몫으로 들어간 곳(꼭 지킬 곳 → 좋아요 순). */
export function peopleOf(stop: RouteStop, members: MemberRef[]): { name: string; color: string }[] {
  const ids = [...(stop.mustFor ?? []), ...(stop.likedBy ?? [])];
  const people: { name: string; color: string }[] = [];
  for (const id of new Set(ids)) {
    const m = members.find((x) => x.memberId === id);
    if (m !== undefined) people.push({ name: m.name, color: m.color });
  }
  return people;
}

/** fixed: 그날 사람이 바꾼 시각(timeKey → 자정부터 분) */
export function dayRows(plan: { route: RouteDay[]; members: MemberRef[] }, day: number, fallbackColor: string, fixed: Record<string, number> = {}): StopRow[] {
  const routeDay = plan.route.find((d) => d.day === day);
  if (routeDay === undefined) return [];
  const times = stopTimes(routeDay.stops, fixed);
  return routeDay.stops.map((stop, i) => {
    const forMembers = peopleOf(stop, plan.members);
    const row: StopRow = {
      itemId: stop.itemId,
      time: times[i]!,
      title: stop.name,
      category: categoryOf(stop),
      forMembers,
      kind: stopKindOf(stop),
      lat: stop.lat,
      lng: stop.lng,
      color: forMembers[0]?.color ?? fallbackColor,
      timeKey: timeKeyOf(stop),
    };
    const moveLabel = moveLabelOf(stop);
    return moveLabel === undefined ? row : { ...row, moveLabel };
  });
}

/**
 * 고치는 중인 일정의 그날 줄. 평소 줄과 같은 모양이고(수정 모드 표시 없음), 뺀 곳은 빠진다.
 * 시각은 바뀐 순서로 다시 짐작하고, 이동 안내는 앞 곳이 원래와 같은 구간에만 붙인다(바뀐 구간은 확정하면 서버가 다시 찾는다).
 */
export function draftDayRows(
  d: PlanDraft,
  dayIndex: number,
  members: MemberRef[],
  fallbackColor: string,
  fixed: Record<string, number> = {},
): StopRow[] {
  const rows = draftRows(d, dayIndex).filter((r) => r.mark !== 'removed');
  const original = d.route[dayIndex]?.stops ?? [];
  // 원래 일정에서도 바로 앞 곳이 같고, 둘 다 식당을 바꾸지 않았으면 서버가 준 이동 시간이 그대로 맞다.
  const sameLeg = (i: number): boolean => {
    const stop = rows[i]!.stop;
    const prev = rows[i - 1]?.stop;
    if (stop === null || prev === undefined || prev === null || rows[i]!.mark === 'swapped' || rows[i - 1]!.mark === 'swapped') return false;
    const at = original.findIndex((s) => s.itemId === stop.itemId);
    return at > 0 && original[at - 1]!.itemId === prev.itemId;
  };
  const keep = rows.map((_, i) => sameLeg(i));
  const slots: TimeSlot[] = rows.map((r, i) => ({
    key: r.stop !== null ? timeKeyOf(r.stop) : (r.added?.placeId ?? r.key),
    kind: r.kind,
    meal: r.meal,
    legMinutes: keep[i] ? (r.stop?.moveFromPrev?.minutes ?? null) : null,
  }));
  const minutes = slotMinutes(slots, fixed);
  return rows.map((r, i) => {
    const forMembers = r.stop !== null ? peopleOf(r.stop, members) : [];
    const base = r.stop !== null ? categoryOf(r.stop) : '관광';
    const row: StopRow = {
      itemId: r.key,
      time: clock(minutes[i]!),
      title: r.name,
      category: r.originalName !== null ? `${base} · ${r.originalName} 대신` : base,
      forMembers,
      kind: r.stop !== null ? stopKindOf(r.stop) : placeKindOf(r.added?.category ?? ''),
      lat: r.stop?.lat ?? r.added?.lat ?? 0,
      lng: r.stop?.lng ?? r.added?.lng ?? 0,
      color: forMembers[0]?.color ?? fallbackColor,
      timeKey: slots[i]!.key,
    };
    const moveLabel = keep[i] && r.stop !== null ? moveLabelOf(r.stop) : undefined;
    return moveLabel === undefined ? row : { ...row, moveLabel };
  });
}

/**
 * 지도에 그리는 것(장소·순서·이름·색·종류)이 같으면 같은 글. 시각·이동 안내처럼 지도에 안 나오는 값은 넣지 않는다.
 * 일정 지도는 무거워서 이 글이 그대로면 다시 그리지 않는다.
 */
export function mapSignature(rows: StopRow[]): string {
  return rows.map((r) => `${r.itemId}|${r.lat}|${r.lng}|${r.title}|${r.color}|${r.kind}`).join('\n');
}

export function routeDayTabs(route: RouteDay[]): { key: string; label: string }[] {
  return [...route].sort((a, b) => a.day - b.day).map((d) => ({ key: `day-${d.day}`, label: `${d.day}일차` }));
}

export function dayOfKey(key: string): number {
  return Number(key.replace('day-', ''));
}
