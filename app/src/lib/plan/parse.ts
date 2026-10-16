import type {
  Plan,
  PlanConcession,
  PlanDay,
  PlanItem,
  PlanMove,
  PlanPlace,
  PlanReason,
  PlanSatisfaction,
  PlanStatus,
  PlanVote,
  PlanVoteDecision,
} from './types.ts';

const STATUSES: readonly string[] = ['voting', 'revising', 'confirmed'];
const DECISIONS: readonly string[] = ['approve', 'revise', 'reject', 'pending'];

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function obj(value: unknown, label: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label}이(가) 객체 형식이 아닙니다.`);
  }
  return value as Obj;
}

function str(o: Obj, key: string, label: string): string {
  const value = o[key];
  if (typeof value !== 'string') return fail(`${label}의 ${key} 값이 문자열이 아닙니다.`);
  return value;
}

function strOrNull(o: Obj, key: string, label: string): string | null {
  const value = o[key];
  if (value === null) return null;
  if (typeof value !== 'string') return fail(`${label}의 ${key} 값이 문자열 또는 null이 아닙니다.`);
  return value;
}

function bool(o: Obj, key: string, label: string): boolean {
  const value = o[key];
  if (typeof value !== 'boolean') return fail(`${label}의 ${key} 값이 true/false가 아닙니다.`);
  return value;
}

function num(o: Obj, key: string, label: string): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${label}의 ${key} 값이 숫자가 아닙니다.`);
  }
  return value;
}

function arr(o: Obj, key: string, label: string): unknown[] {
  const value = o[key];
  if (!Array.isArray(value)) return fail(`${label}의 ${key} 값이 배열이 아닙니다.`);
  return value;
}

function parseMove(value: unknown, label: string): PlanMove | null {
  if (value === null) return null;
  const l = `${label}의 이동 정보`;
  const o = obj(value, l);
  return {
    mode: str(o, 'mode', l),
    minutes: num(o, 'minutes', l),
    distanceM: num(o, 'distanceM', l),
    fareWon: num(o, 'fareWon', l),
    source: str(o, 'source', l),
    routeUrl: str(o, 'routeUrl', l),
  };
}

function parsePlace(value: unknown, label: string): PlanPlace {
  const l = `${label}의 장소`;
  const o = obj(value, l);
  const links = obj(o.links, `${l}의 links`);
  return {
    id: str(o, 'id', l),
    name: str(o, 'name', l),
    address: str(o, 'address', l),
    lat: num(o, 'lat', l),
    lng: num(o, 'lng', l),
    openHours: strOrNull(o, 'openHours', l),
    menu: strOrNull(o, 'menu', l),
    popularity: num(o, 'popularity', l),
    crowd: num(o, 'crowd', l),
    priceLevel: num(o, 'priceLevel', l),
    kakaoPlaceId: strOrNull(o, 'kakaoPlaceId', l),
    verified: bool(o, 'verified', l),
    links: {
      kakaoMap: str(links, 'kakaoMap', `${l}의 links`),
      naverMap: str(links, 'naverMap', `${l}의 links`),
    },
    sources: arr(o, 'sources', l).map((s) =>
      typeof s === 'string' ? s : fail(`${l}의 sources 항목이 문자열이 아닙니다.`),
    ),
    baseDate: str(o, 'baseDate', l),
    checkedAt: str(o, 'checkedAt', l),
  };
}

function parseReason(value: unknown, label: string): PlanReason {
  const l = `${label}의 이유`;
  const o = obj(value, l);
  return { memberId: str(o, 'memberId', l), text: str(o, 'text', l) };
}

function parseItem(value: unknown, label: string): PlanItem {
  const o = obj(value, label);
  return {
    id: str(o, 'id', label),
    startTime: str(o, 'startTime', label),
    title: str(o, 'title', label),
    category: str(o, 'category', label),
    costPerPerson: num(o, 'costPerPerson', label),
    moveFromPrev: parseMove(o.moveFromPrev, label),
    place: parsePlace(o.place, label),
    forMembers: arr(o, 'forMembers', label).map((m) =>
      typeof m === 'string' ? m : fail(`${label}의 forMembers 항목이 문자열이 아닙니다.`),
    ),
    reasons: arr(o, 'reasons', label).map((r) => parseReason(r, label)),
  };
}

function parseDay(value: unknown, index: number): PlanDay {
  const label = `${index + 1}번째 날`;
  const o = obj(value, label);
  return {
    day: num(o, 'day', label),
    date: str(o, 'date', label),
    items: arr(o, 'items', label).map((item, i) => parseItem(item, `${label}의 ${i + 1}번째 항목`)),
  };
}

function parseSatisfaction(value: unknown, index: number): PlanSatisfaction {
  const label = `${index + 1}번째 만족도`;
  const o = obj(value, label);
  return { memberId: str(o, 'memberId', label), score: num(o, 'score', label) };
}

function parseConcession(value: unknown, index: number): PlanConcession {
  const label = `${index + 1}번째 양보`;
  const o = obj(value, label);
  return {
    memberId: str(o, 'memberId', label),
    gave: str(o, 'gave', label),
    got: str(o, 'got', label),
  };
}

function parseVote(value: unknown, index: number): PlanVote {
  const label = `${index + 1}번째 투표`;
  const o = obj(value, label);
  const decision = str(o, 'decision', label);
  if (!DECISIONS.includes(decision)) {
    return fail(`${label}의 decision 값이 올바르지 않습니다: ${decision}`);
  }
  return { memberId: str(o, 'memberId', label), decision: decision as PlanVoteDecision };
}

export function parsePlan(json: unknown): Plan {
  const root = obj(json, '일정 응답');
  if (!('plan' in root)) return fail('일정 응답에 plan이 없습니다.');
  const label = '일정';
  const o = obj(root.plan, label);
  const status = str(o, 'status', label);
  if (!STATUSES.includes(status)) return fail(`일정의 status 값이 올바르지 않습니다: ${status}`);
  return {
    id: str(o, 'id', label),
    version: num(o, 'version', label),
    status: status as PlanStatus,
    costPerPerson: num(o, 'costPerPerson', label),
    budgetPerPerson: num(o, 'budgetPerPerson', label),
    maxStepsPerDay: num(o, 'maxStepsPerDay', label),
    satisfaction: arr(o, 'satisfaction', label).map(parseSatisfaction),
    concessions: arr(o, 'concessions', label).map(parseConcession),
    votes: arr(o, 'votes', label).map(parseVote),
    days: arr(o, 'days', label).map(parseDay),
  };
}

export function totalItems(plan: Plan): number {
  return plan.days.reduce((sum, day) => sum + day.items.length, 0);
}

export function memberReasons(item: PlanItem, memberId: string): string[] {
  return item.reasons.filter((r) => r.memberId === memberId).map((r) => r.text);
}

export function needsMapCheck(item: PlanItem): boolean {
  return item.place.verified === false;
}
