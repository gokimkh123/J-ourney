import { ApiError } from '../api/errors.ts';
import { parseEventObject } from './parse.ts';
import type { ServerEvent } from './types.ts';

/** 서버가 알려 주는 회의 상태(명세서 4.4): researching 조사 중, reviewing 사람 확인 기다림, done 끝, failed 실패 */
export type ServerMeetingStatus = 'researching' | 'reviewing' | 'done' | 'failed';

export type ReviewItem = { placeId: string; name: string; text: string; consequence: string | null };
export type ReviewChoice = { placeId: string; keep: boolean };
export type ReviewVote = { placeId: string; keep: number; drop: number; kept: boolean; tie: boolean };
export type ReviewDecision = {
  kept: string[];
  dropped: string[];
  votes: ReviewVote[];
  responded: string[];
  defaulted: string[];
  closedBy: 'all' | 'host';
};

/** 사람 확인(5단계) 현황. mine은 내가 아직 안 냈으면 null */
export type ReviewState = {
  items: ReviewItem[];
  memos: string[];
  total: number;
  responded: string[];
  mine: ReviewChoice[] | null;
  decision: ReviewDecision | null;
};

export type ServerMeeting = {
  id: string;
  tripId: string;
  runNo: number;
  status: ServerMeetingStatus;
  llmCalls: number;
  startedAt: string;
  finishedAt: string | null;
  review: ReviewState | null;
};

export type MeetingStart = { id: string; status: 'researching'; maxRounds: number | null };

const STATUSES: readonly string[] = ['researching', 'reviewing', 'done', 'failed'];

function bad(): never {
  throw new ApiError(0, 'BAD_RESPONSE', '서버 응답을 읽을 수 없어요');
}

function rec(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad();
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : bad();
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : bad();
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str) : bad();
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : bad();
}

function parseReview(value: unknown): ReviewState {
  const r = rec(value);
  const mine = r.mine === null || r.mine === undefined ? null : list(r.mine).map((c) => {
    const o = rec(c);
    if (typeof o.keep !== 'boolean') return bad();
    return { placeId: str(o.placeId), keep: o.keep };
  });
  let decision: ReviewDecision | null = null;
  if (r.decision !== null && r.decision !== undefined) {
    const d = rec(r.decision);
    if (d.closedBy !== 'all' && d.closedBy !== 'host') return bad();
    decision = {
      kept: strList(d.kept),
      dropped: strList(d.dropped),
      responded: strList(d.responded),
      defaulted: strList(d.defaulted),
      closedBy: d.closedBy,
      votes: list(d.votes).map((v) => {
        const o = rec(v);
        if (typeof o.kept !== 'boolean' || typeof o.tie !== 'boolean') return bad();
        return { placeId: str(o.placeId), keep: num(o.keep), drop: num(o.drop), kept: o.kept, tie: o.tie };
      }),
    };
  }
  return {
    items: list(r.items).map((i) => {
      const o = rec(i);
      return {
        placeId: str(o.placeId),
        name: str(o.name),
        text: str(o.text),
        consequence: o.consequence === null || o.consequence === undefined ? null : str(o.consequence),
      };
    }),
    memos: strList(r.memos),
    total: num(r.total),
    responded: strList(r.responded),
    mine,
    decision,
  };
}

/** POST /trips/{id}/meetings 응답 (202) */
export function parseMeetingStart(json: unknown): MeetingStart {
  const m = rec(rec(json).meeting);
  if (m.status !== 'researching') return bad();
  return { id: str(m.id), status: 'researching', maxRounds: m.maxRounds === null || m.maxRounds === undefined ? null : num(m.maxRounds) };
}

/** GET /meetings/{id}, POST review·review/close 응답 */
export function parseMeeting(json: unknown): ServerMeeting {
  const m = rec(rec(json).meeting);
  const status = str(m.status);
  if (!STATUSES.includes(status)) return bad();
  return {
    id: str(m.id),
    tripId: str(m.tripId),
    runNo: num(m.runNo),
    status: status as ServerMeetingStatus,
    llmCalls: num(m.llmCalls),
    startedAt: str(m.startedAt),
    finishedAt: m.finishedAt === null || m.finishedAt === undefined ? null : str(m.finishedAt),
    review: m.review === null || m.review === undefined ? null : parseReview(m.review),
  };
}

/** GET /trips/{id}/events 응답. 앱이 아직 모르는 종류의 이벤트는 건너뛴다. */
export function parseEvents(json: unknown): ServerEvent[] {
  const events = list(rec(json).events);
  const out: ServerEvent[] = [];
  for (const e of events) {
    const parsed = parseEventObject(e);
    if (parsed !== null && parsed.type !== 'ping') out.push(parsed);
  }
  return out;
}
