import { ApiError } from '../api/errors.ts';
import type { MoveLeg, RouteDay, RouteStop } from '../meeting/types.ts';

export type PlanLabel = 'A' | 'B';
export type PlanBoardStatus = 'choosing' | 'revising' | 'voting' | 'confirmed';

export type ProposedPlan = {
  planId: string;
  version: number;
  label: PlanLabel;
  moveMode: 'transit' | 'car';
  lodging: { placeId: string; name: string } | null;
  route: RouteDay[];
  notes: string[];
  changes: string[];
};

export type PlanCandidate = {
  planId: string;
  label: PlanLabel;
  version: number;
  title: string;
  summary: string;
  satisfaction: {
    average: number;
    passed: boolean;
    members: { memberId: string; agentId: string; score: number; stance: string }[];
  };
  concessions: { memberId: string; mustMissed: string[]; warned: string[] }[];
  plan: ProposedPlan;
};

export type PlanChosen = {
  planId: string;
  label: PlanLabel;
  by: 'all' | 'host';
  tie: boolean;
  votes: { A: number; B: number };
};

export type PlanEditRecord = { version: number; by: string; at: string; changes: string[] };

export type PlanConfirm = {
  version: number;
  votes: { memberId: string; decision: 'approve' | 'reject' }[];
  answered: number;
  total: number;
};

export type PlanBoard = {
  status: PlanBoardStatus;
  meetingId: string;
  candidates: PlanCandidate[];
  choice: {
    votes: { memberId: string; planId: string }[];
    answered: number;
    total: number;
    chosen: PlanChosen | null;
  };
  plan: ProposedPlan | null;
  edits: PlanEditRecord[];
  confirm: PlanConfirm | null;
  confirmedAt: string | null;
};

export type EditResult = { applied: boolean; note: string };

export type EditOptions = {
  sights: {
    placeId: string;
    name: string;
    category: string | null;
    lat: number;
    lng: number;
    likedBy: string[];
    mustFor: string[];
    closedDays: number[];
  }[];
  meals: Record<string, { placeId: string; name: string; category: string | null; detourKm: number }[]>;
};

type Obj = Record<string, unknown>;

function badResponse(): ApiError {
  return new ApiError(0, 'BAD_RESPONSE', '서버 응답을 읽을 수 없어요');
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number';
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isStr) : [];
}

function objItems(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function readLabel(v: unknown): PlanLabel | null {
  return v === 'A' || v === 'B' ? v : null;
}

const MODES = ['walk', 'bus', 'subway', 'train', 'taxi', 'car'] as const;

function readMoveLeg(v: unknown): MoveLeg | null {
  if (!isObj(v)) return null;
  const mode = MODES.find((m) => m === v.mode) ?? null;
  const leg: MoveLeg = {
    mode,
    minutes: isNum(v.minutes) ? v.minutes : null,
    distanceM: isNum(v.distanceM) ? v.distanceM : 0,
    fareWon: isNum(v.fareWon) ? v.fareWon : null,
    source: v.source === 'kakao_route' ? 'kakao_route' : 'estimate',
    routeUrl: isStr(v.routeUrl) ? v.routeUrl : null,
  };
  if (isStr(v.note)) leg.note = v.note;
  return leg;
}

function readStop(v: Obj): RouteStop | null {
  if (!isStr(v.itemId) || !isStr(v.name) || !isFiniteNum(v.lat) || !isFiniteNum(v.lng)) return null;
  const stop: RouteStop = { itemId: v.itemId, name: v.name, lat: v.lat, lng: v.lng };
  if (isStr(v.placeId)) stop.placeId = v.placeId;
  if (v.kind === 'sight' || v.kind === 'food' || v.kind === 'lodging') stop.kind = v.kind;
  if (v.category === null || isStr(v.category)) stop.category = v.category;
  if (v.meal === null || v.meal === 'lunch' || v.meal === 'dinner') stop.meal = v.meal;
  if (typeof v.night === 'boolean') stop.night = v.night;
  if (Array.isArray(v.mustFor)) stop.mustFor = strArray(v.mustFor);
  if (Array.isArray(v.likedBy)) stop.likedBy = strArray(v.likedBy);
  if (v.moveFromPrev !== undefined) stop.moveFromPrev = readMoveLeg(v.moveFromPrev);
  return stop;
}

function readRoute(items: unknown[]): RouteDay[] {
  const days: RouteDay[] = [];
  for (const d of items) {
    if (!isObj(d) || !isNum(d.day) || !Array.isArray(d.stops)) continue;
    const stops: RouteStop[] = [];
    for (const s of objItems(d.stops)) {
      const stop = readStop(s);
      if (stop) stops.push(stop);
    }
    const day: RouteDay = { day: d.day, stops };
    if (isStr(d.date)) day.date = d.date;
    const sm = d.summary;
    if (
      isObj(sm) &&
      isNum(sm.moveMinutes) &&
      isNum(sm.unknownLegs) &&
      isNum(sm.spanMinutes) &&
      typeof sm.heavy === 'boolean'
    ) {
      day.summary = {
        moveMinutes: sm.moveMinutes,
        unknownLegs: sm.unknownLegs,
        spanMinutes: sm.spanMinutes,
        heavy: sm.heavy,
      };
    }
    days.push(day);
  }
  return days;
}

function readPlan(v: unknown): ProposedPlan | null {
  if (!isObj(v)) return null;
  const label = readLabel(v.label);
  if (!isStr(v.planId) || label === null || !Array.isArray(v.route)) return null;
  const lg = v.lodging;
  return {
    planId: v.planId,
    version: isNum(v.version) ? v.version : 1,
    label,
    moveMode: v.moveMode === 'car' ? 'car' : 'transit',
    lodging: isObj(lg) && isStr(lg.placeId) && isStr(lg.name) ? { placeId: lg.placeId, name: lg.name } : null,
    route: readRoute(v.route),
    notes: strArray(v.notes),
    changes: strArray(v.changes),
  };
}

function readSatisfaction(v: unknown): PlanCandidate['satisfaction'] {
  if (!isObj(v) || !isNum(v.average) || typeof v.passed !== 'boolean' || !Array.isArray(v.members)) {
    return { average: 0, passed: false, members: [] };
  }
  const members: PlanCandidate['satisfaction']['members'] = [];
  for (const m of objItems(v.members)) {
    if (isStr(m.memberId) && isStr(m.agentId) && isNum(m.score) && isStr(m.stance)) {
      members.push({ memberId: m.memberId, agentId: m.agentId, score: m.score, stance: m.stance });
    }
  }
  return { average: v.average, passed: v.passed, members };
}

function readCandidate(v: Obj): PlanCandidate | null {
  const label = readLabel(v.label);
  const plan = readPlan(v.plan);
  if (!isStr(v.planId) || label === null || plan === null) return null;
  const concessions: PlanCandidate['concessions'] = [];
  for (const c of objItems(v.concessions)) {
    if (isStr(c.memberId)) {
      concessions.push({ memberId: c.memberId, mustMissed: strArray(c.mustMissed), warned: strArray(c.warned) });
    }
  }
  return {
    planId: v.planId,
    label,
    version: isNum(v.version) ? v.version : 1,
    title: isStr(v.title) ? v.title : `${label}안`,
    summary: isStr(v.summary) ? v.summary : '',
    satisfaction: readSatisfaction(v.satisfaction),
    concessions,
    plan,
  };
}

function readChosen(v: unknown): PlanChosen | null {
  if (!isObj(v)) return null;
  const label = readLabel(v.label);
  if (!isStr(v.planId) || label === null) return null;
  const votes = isObj(v.votes) ? v.votes : {};
  return {
    planId: v.planId,
    label,
    by: v.by === 'host' ? 'host' : 'all',
    tie: typeof v.tie === 'boolean' ? v.tie : false,
    votes: { A: isNum(votes.A) ? votes.A : 0, B: isNum(votes.B) ? votes.B : 0 },
  };
}

function readConfirm(v: unknown): PlanConfirm | null {
  if (!isObj(v)) return null;
  const votes: PlanConfirm['votes'] = [];
  for (const x of objItems(v.votes)) {
    if (isStr(x.memberId) && (x.decision === 'approve' || x.decision === 'reject')) {
      votes.push({ memberId: x.memberId, decision: x.decision });
    }
  }
  return {
    version: isNum(v.version) ? v.version : 0,
    votes,
    answered: isNum(v.answered) ? v.answered : 0,
    total: isNum(v.total) ? v.total : 0,
  };
}

export function parsePlanBoard(json: unknown): PlanBoard {
  if (!isObj(json)) throw badResponse();
  const { status, meetingId, candidates, choice, edits } = json;
  if (
    (status !== 'choosing' && status !== 'revising' && status !== 'voting' && status !== 'confirmed') ||
    !isStr(meetingId) ||
    !Array.isArray(candidates) ||
    !Array.isArray(edits) ||
    !isObj(choice)
  ) {
    throw badResponse();
  }

  const readCandidates: PlanCandidate[] = [];
  for (const c of objItems(candidates)) {
    const cand = readCandidate(c);
    if (cand) readCandidates.push(cand);
  }

  const votes: PlanBoard['choice']['votes'] = [];
  for (const x of objItems(choice.votes)) {
    if (isStr(x.memberId) && isStr(x.planId)) votes.push({ memberId: x.memberId, planId: x.planId });
  }

  const readEdits: PlanEditRecord[] = [];
  for (const e of objItems(edits)) {
    if (isNum(e.version) && isStr(e.by)) {
      readEdits.push({ version: e.version, by: e.by, at: isStr(e.at) ? e.at : '', changes: strArray(e.changes) });
    }
  }

  return {
    status,
    meetingId,
    candidates: readCandidates,
    choice: {
      votes,
      answered: isNum(choice.answered) ? choice.answered : 0,
      total: isNum(choice.total) ? choice.total : 0,
      chosen: readChosen(choice.chosen),
    },
    plan: readPlan(json.plan),
    edits: readEdits,
    confirm: readConfirm(json.confirm),
    confirmedAt: isStr(json.confirmedAt) ? json.confirmedAt : null,
  };
}

export function parseEditResults(json: unknown): EditResult[] {
  if (!isObj(json) || !Array.isArray(json.results)) return [];
  const out: EditResult[] = [];
  for (const r of objItems(json.results)) {
    if (typeof r.applied === 'boolean' && isStr(r.note)) out.push({ applied: r.applied, note: r.note });
  }
  return out;
}

export function parseEditOptions(json: unknown): EditOptions {
  if (!isObj(json)) throw badResponse();

  const sights: EditOptions['sights'] = [];
  for (const s of objItems(json.sights)) {
    if (isStr(s.placeId) && isStr(s.name) && isFiniteNum(s.lat) && isFiniteNum(s.lng)) {
      sights.push({
        placeId: s.placeId,
        name: s.name,
        category: isStr(s.category) ? s.category : null,
        lat: s.lat,
        lng: s.lng,
        likedBy: strArray(s.likedBy),
        mustFor: strArray(s.mustFor),
        closedDays: Array.isArray(s.closedDays) ? s.closedDays.filter(isNum) : [],
      });
    }
  }

  const meals: EditOptions['meals'] = {};
  if (isObj(json.meals)) {
    for (const [key, list] of Object.entries(json.meals)) {
      if (!Array.isArray(list)) continue;
      meals[key] = objItems(list)
        .filter((m) => isStr(m.placeId) && isStr(m.name))
        .map((m) => ({
          placeId: m.placeId as string,
          name: m.name as string,
          category: isStr(m.category) ? m.category : null,
          detourKm: isNum(m.detourKm) ? m.detourKm : 0,
        }));
    }
  }

  return { sights, meals };
}
