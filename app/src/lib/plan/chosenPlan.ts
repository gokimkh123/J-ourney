import type { PlaceKind } from '../../components/PlaceSticker.tsx';
import type { RouteDay, RouteStop } from '../meeting/types.ts';
import type { MemberRef } from '../meeting/view.ts';
import { createValueStore } from '../store/valueStore.ts';
import { formatWon, moveModeLabel } from '../ui/format.ts';
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
};

// 시각 짐작: 하루는 9시에 시작하고, 머무는 시간은 종류별로 고정한다. 점심·저녁은 그 시각 전에는 시작하지 않는다.
const DAY_START = 9 * 60;
const STAY: Record<NonNullable<RouteStop['kind']>, number> = { sight: 90, food: 60, lodging: 30 };
const UNKNOWN_LEG_MINUTES = 15;
const LUNCH_AT = 12 * 60;
const DINNER_AT = 18 * 60;

function clock(minutes: number): string {
  const m = Math.min(minutes, 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function stopTimes(stops: RouteStop[]): string[] {
  const times: string[] = [];
  let t = DAY_START;
  stops.forEach((stop, i) => {
    if (i > 0) {
      const prev = stops[i - 1]!;
      t += STAY[prev.kind ?? 'sight'] + (stop.moveFromPrev?.minutes ?? UNKNOWN_LEG_MINUTES);
    }
    if (stop.meal === 'lunch') t = Math.max(t, LUNCH_AT);
    if (stop.meal === 'dinner') t = Math.max(t, DINNER_AT);
    times.push(clock(t));
  });
  return times;
}

function categoryOf(stop: RouteStop): string {
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
  return leg.fareWon !== null && leg.fareWon > 0 ? `${base} · ${formatWon(leg.fareWon)}` : base;
}

/** 이 사람 몫으로 들어간 곳(꼭 지킬 곳 → 좋아요 순). */
function peopleOf(stop: RouteStop, members: MemberRef[]): { name: string; color: string }[] {
  const ids = [...(stop.mustFor ?? []), ...(stop.likedBy ?? [])];
  const people: { name: string; color: string }[] = [];
  for (const id of new Set(ids)) {
    const m = members.find((x) => x.memberId === id);
    if (m !== undefined) people.push({ name: m.name, color: m.color });
  }
  return people;
}

export function dayRows(plan: { route: RouteDay[]; members: MemberRef[] }, day: number, fallbackColor: string): StopRow[] {
  const routeDay = plan.route.find((d) => d.day === day);
  if (routeDay === undefined) return [];
  const times = stopTimes(routeDay.stops);
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
    };
    const moveLabel = moveLabelOf(stop);
    return moveLabel === undefined ? row : { ...row, moveLabel };
  });
}

export function routeDayTabs(route: RouteDay[]): { key: string; label: string }[] {
  return [...route].sort((a, b) => a.day - b.day).map((d) => ({ key: `day-${d.day}`, label: `${d.day}일차` }));
}

export function dayOfKey(key: string): number {
  return Number(key.replace('day-', ''));
}
