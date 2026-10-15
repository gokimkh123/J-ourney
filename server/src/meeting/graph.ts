import { Annotation, type BaseCheckpointSaver, END, START, Send, StateGraph, getWriter } from '@langchain/langgraph';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { members, personas, regions, trips } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import type { LlmClient } from '../llm/client.js';
import { memberColor } from '../routes/views.js';
import type { TourClient } from '../tour/client.js';
import { type PickResult, boardOf, buildPickGraph } from './pick.js';
import { type MemberInput, type RetrieveResult, retrieveCandidates } from './retrieve.js';
import { type MeetingEventDraft, type MeetingLimits, agentIdOf, reserveMeetingLlm } from './runs.js';
import type { ResolvedDestination, TripConditions } from './types.js';

/** 회의 공유 상태 (단계를 하나씩 붙이며 늘림) */
export const MeetingState = Annotation.Root({
  tripId: Annotation<string>(),
  /** 회의 실행 id (mtg_). 1–2단계만 시험할 때는 없음 */
  meetingId: Annotation<string | null>(),
  conditions: Annotation<TripConditions | null>(),
  destination: Annotation<ResolvedDestination | null>(),
  members: Annotation<MemberInput[]>(),
  /** 2단계 결과: 후보 40곳·LLM용 한 줄 표·거른 이유 */
  pool: Annotation<RetrieveResult | null>(),
  /** 3단계 결과: AI 4명이 고른 곳 (사람마다 동시에 끝나는 대로 합쳐짐) */
  picks: Annotation<PickResult[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  /** 3단계 끝의 후보 보드 (명세서 board.updated의 data) */
  board: Annotation<ReturnType<typeof boardOf> | null>(),
});
export type MeetingStateType = typeof MeetingState.State;

export interface MeetingDeps {
  db: Db;
  /** 집중률 예측 호출기 (null이면 받아 둔 예측만 씀) */
  crowdClient: TourClient | null;
  today?: string;
  /** 3단계부터 씀 (null이면 규칙 고르기) */
  llm?: LlmClient | null;
  limits?: MeetingLimits;
  /** true면 LLM 요청·받는 글자·응답을 시험 화면용 이벤트로 보냄 */
  traceLlm?: boolean;
  /** 단계 저장 (LangGraph 체크포인트). 없으면 저장하지 않음 */
  checkpointer?: BaseCheckpointSaver;
}

const emit = (e: MeetingEventDraft) => getWriter()?.(e);

/** 회의를 시작할 수 있는지 확인하고 여행·구성원·성향을 읽음 (조건 저장·4명 성향 완료). 회의 실행 전에도 불러 실행 횟수를 헛되이 쓰지 않게 함 */
export async function loadMeetingInput(db: Db, tripId: string) {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
  if (!trip.conditions || !trip.regionCode) throw new ApiError('VALIDATION_ERROR', '회의 조건을 먼저 저장해야 함 (PUT /trips/{tripId}/conditions)');
  const rows = await db
    .select({ member: members, persona: personas })
    .from(members)
    .leftJoin(personas, eq(personas.memberId, members.id))
    .where(eq(members.tripId, trip.id))
    .orderBy(asc(members.seat));
  const missing = rows.filter((r) => !r.persona).map((r) => r.member.nickname);
  if (missing.length) throw new ApiError('PERSONA_REQUIRED', `성향 설문을 마치지 않은 구성원: ${missing.join(', ')}`);
  return { trip: { ...trip, conditions: trip.conditions, regionCode: trip.regionCode }, rows: rows.map((r) => ({ member: r.member, persona: r.persona! })) };
}

/** 1단계 준비: 회의 조건과 4명의 성향을 DB에서 읽음 (닉네임은 화면용으로만 두고 LLM에는 넣지 않음) */
async function prepare(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const { trip, rows } = await loadMeetingInput(deps.db, state.tripId);
  const [region] = await deps.db.select({ name: regions.regionName }).from(regions).where(eq(regions.regionCode, trip.regionCode)).limit(1);
  if (state.meetingId) {
    emit({
      type: 'meeting.started',
      data: {
        meetingId: state.meetingId,
        kind: 'meeting',
        maxRounds: trip.conditions.rules.maxRounds,
        agents: rows.map(({ member, persona }) => ({ agentId: agentIdOf(member.id), memberId: member.id, nickname: member.nickname, title: persona.title, chips: persona.chips.map((c) => c.label), color: memberColor(member) })),
      },
    });
    for (const { member } of rows) emit({ type: 'research.progress', data: { agentId: agentIdOf(member.id), stage: 'planning', tool: null, focus: null, foundCount: 0 } });
  }
  return {
    conditions: trip.conditions,
    destination: { regionCode: trip.regionCode, regionName: region?.name ?? '', districtCodes: trip.districtCodes ?? [], label: trip.conditions.destination },
    members: rows.map(({ member, persona }) => ({
      memberId: member.id,
      nickname: member.nickname,
      title: persona.title,
      likes: persona.answers.likes,
      dislikes: persona.answers.dislikes,
      mustKeep: persona.mustKeep,
      profile: persona.profile,
      wishes: persona.wishes,
      chips: persona.chips.map((c) => c.label),
      color: memberColor(member),
    })),
  };
}

/** 2단계 후보 찾기 (코드, LLM 0회) */
async function retrieve(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const result = await retrieveCandidates(deps.db, {
    conditions: state.conditions!,
    destination: state.destination!,
    members: state.members,
    crowdClient: deps.crowdClient,
    today: deps.today,
  });
  if (state.meetingId) {
    // 사람마다 조사 과정을 실제 자료로 알림 (지도에서 캐릭터가 그 장소로 이동): 장소 찾기 → 인기 순위 → 혼잡도
    const at = (c: { lat: number | null; lng: number | null; name: string } | undefined) => (c && c.lat !== null && c.lng !== null ? { lat: c.lat, lng: c.lng, label: c.name } : null);
    for (const m of state.members) {
      const agentId = agentIdOf(m.memberId);
      const mine = result.candidates.filter((c) => c.forMembers.includes(m.memberId)).sort((a, b) => b.scores[m.memberId] - a.scores[m.memberId]);
      emit({ type: 'research.progress', data: { agentId, stage: 'searching', tool: 'tourSearch', focus: at(mine[0]), foundCount: mine.length } });
      const popular = [...mine].filter((c) => c.popularity !== null).sort((a, b) => b.popularity! - a.popularity!)[0];
      emit({ type: 'research.progress', data: { agentId, stage: 'searching', tool: 'tourRank', focus: at(popular), foundCount: result.popularity.matched } });
      const crowded = mine.find((c) => c.crowd !== null);
      if (crowded) emit({ type: 'research.progress', data: { agentId, stage: 'searching', tool: 'crowd', focus: at(crowded), foundCount: result.crowd.matched } });
    }
  }
  return { pool: result };
}

/** 3단계 끝: 4명이 고른 곳을 후보 보드로 모음 (코드, LLM 0회) */
async function gather(state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const board = boardOf(state.picks, state.pool!);
  emit({ type: 'board.updated', data: board });
  return { board };
}

/** 회의 그래프의 노드 이름과 단계 (시험 화면의 그래프 칸에 씀) */
export const MEETING_NODES = [
  { id: 'prepare', step: 1, label: '준비', kind: 'code' },
  { id: 'retrieve', step: 2, label: '후보 찾기', kind: 'code' },
  { id: 'pick', step: 3, label: '고르기 ×4', kind: 'llm' },
  { id: 'gather', step: 3, label: '후보 보드 모으기', kind: 'code' },
] as const;

/** 실제 회의 그래프의 노드·연결 (그래프를 만들기만 하고 실행하지 않음) */
export async function meetingGraphShape() {
  const graph = await buildMeetingGraph({ db: null as unknown as Db, crowdClient: null }).getGraphAsync();
  const meta = new Map<string, (typeof MEETING_NODES)[number]>(MEETING_NODES.map((n) => [n.id, n]));
  return {
    nodes: Object.keys(graph.nodes).map((id) => ({ id, step: meta.get(id)?.step ?? null, label: meta.get(id)?.label ?? id, kind: meta.get(id)?.kind ?? 'edge' })),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target, conditional: !!e.conditional })),
  };
}

/**
 * 회의 그래프: 준비 → 후보 찾기 → 고르기 ×4 (사람마다 서브그래프를 동시에 띄움, Send) → 후보 보드
 * upTo 'retrieve'면 2단계에서 멈춤 (LLM 0회 시험용)
 */
export function buildMeetingGraph(deps: MeetingDeps, opts: { upTo?: 'retrieve' } = {}) {
  const base = new StateGraph(MeetingState)
    .addNode('prepare', (s) => prepare(deps, s))
    .addNode('retrieve', (s) => retrieve(deps, s))
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'retrieve');
  if (opts.upTo === 'retrieve') return base.addEdge('retrieve', END).compile({ checkpointer: deps.checkpointer });
  const pickGraph = buildPickGraph({
    llm: deps.llm ?? null,
    traceLlm: deps.traceLlm,
    reserveLlm: (meetingId) => (meetingId && deps.limits ? reserveMeetingLlm(deps.db, meetingId, deps.limits) : Promise.resolve(false)),
  });
  return base
    .addNode('pick', pickGraph)
    .addNode('gather', gather)
    .addConditionalEdges(
      'retrieve',
      (s) => s.members.map((m) => new Send('pick', { who: m, from: s.pool, meeting: s.meetingId, draft: null, tries: 0, calls: 0, blocked: false, picks: [] })),
      ['pick'],
    )
    .addEdge('pick', 'gather')
    .addEdge('gather', END)
    .compile({ checkpointer: deps.checkpointer });
}
