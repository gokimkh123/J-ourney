import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { members, personas, regions, trips } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import type { TourClient } from '../tour/client.js';
import { type MemberInput, type RetrieveResult, retrieveCandidates } from './retrieve.js';
import type { ResolvedDestination, TripConditions } from './types.js';

/** 회의 공유 상태 (단계를 하나씩 붙이며 늘림) */
export const MeetingState = Annotation.Root({
  tripId: Annotation<string>(),
  conditions: Annotation<TripConditions | null>(),
  destination: Annotation<ResolvedDestination | null>(),
  members: Annotation<MemberInput[]>(),
  /** 2단계 결과: 후보 40곳·LLM용 한 줄 표·거른 이유 */
  pool: Annotation<RetrieveResult | null>(),
});
export type MeetingStateType = typeof MeetingState.State;

export interface MeetingDeps {
  db: Db;
  /** 집중률 예측 호출기 (null이면 받아 둔 예측만 씀) */
  crowdClient: TourClient | null;
  today?: string;
}

/** 1단계 준비: 회의 조건과 4명의 성향을 DB에서 읽음 (닉네임은 화면용으로만 두고 LLM에는 넣지 않음) */
async function prepare(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const [trip] = await deps.db.select().from(trips).where(eq(trips.id, state.tripId)).limit(1);
  if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
  if (!trip.conditions || !trip.regionCode) throw new ApiError('VALIDATION_ERROR', '회의 조건을 먼저 저장해야 함 (PUT /trips/{tripId}/conditions)');
  const rows = await deps.db
    .select({ member: members, persona: personas })
    .from(members)
    .leftJoin(personas, eq(personas.memberId, members.id))
    .where(eq(members.tripId, trip.id))
    .orderBy(asc(members.seat));
  const missing = rows.filter((r) => !r.persona).map((r) => r.member.nickname);
  if (missing.length) throw new ApiError('PERSONA_REQUIRED', `성향 설문을 마치지 않은 구성원: ${missing.join(', ')}`);
  const [region] = await deps.db.select({ name: regions.regionName }).from(regions).where(eq(regions.regionCode, trip.regionCode)).limit(1);
  return {
    conditions: trip.conditions,
    destination: { regionCode: trip.regionCode, regionName: region?.name ?? '', districtCodes: trip.districtCodes ?? [], label: trip.conditions.destination },
    members: rows.map(({ member, persona }) => ({
      memberId: member.id,
      nickname: member.nickname,
      title: persona!.title,
      likes: persona!.answers.likes,
      dislikes: persona!.answers.dislikes,
      mustKeep: persona!.mustKeep,
      profile: persona!.profile,
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
  return { pool: result };
}

/** 회의 그래프의 노드 이름과 단계 (시험 화면의 그래프 칸에 씀) */
export const MEETING_NODES = [
  { id: 'prepare', step: 1, label: '준비', kind: 'code' },
  { id: 'retrieve', step: 2, label: '후보 찾기', kind: 'code' },
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

/** 회의 그래프 (지금은 1–2단계: 준비 → 후보 찾기) */
export function buildMeetingGraph(deps: MeetingDeps) {
  return new StateGraph(MeetingState)
    .addNode('prepare', (s) => prepare(deps, s))
    .addNode('retrieve', (s) => retrieve(deps, s))
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'retrieve')
    .addEdge('retrieve', END)
    .compile();
}
