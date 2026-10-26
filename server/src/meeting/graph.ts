import { Annotation, type BaseCheckpointSaver, END, START, Send, StateGraph, getWriter, interrupt } from '@langchain/langgraph';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { MIN_MEMBERS, members, personas, regions, trips } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import type { LlmClient } from '../llm/client.js';
import type { LlmRecorder } from '../llm/record.js';
import { memberColor } from '../routes/views.js';
import type { TourClient } from '../tour/client.js';
import { type SavedNameMatch, nameMatcher, savedNameMatcher } from './names.js';
import { type PickResult, boardOf, buildPickGraph, savedPickFor } from './pick.js';
import { type AiReaction, REACT, reactBoard } from './react.js';
import { acceptReactions, reactRequest } from './react-ai.js';
import { type MemberInput, type RetrieveResult, retrieveCandidates } from './retrieve.js';
import { applyReview, reviewRequestOf } from './review.js';
import { ROUTE, type RouteClient, type RouteMeter, cachedRouter, newRouteMeter } from './route.js';
import { type PlanProposal, SCHEDULE, schedulePlans } from './schedule.js';
import { type MeetingEventDraft, type MeetingLimits, agentIdOf, reserveMeetingLlm } from './runs.js';
import type { Board, ResolvedDestination, ReviewDecision, ReviewRequest, TripConditions } from './types.js';

/**
 * LLM_REPLAY에서 다시 쓰는 지난 결과: 같은 여행의 지난 회의(조건이 같고, 그 뒤로 성향을 바꾸지 않은 사람)에서 AI가 고른 곳과 이름 맞추기
 * 실행기가 회의를 시작할 때 체크포인트에서 모아 넘김 (LLM_REPLAY가 꺼져 있으면 null)
 */
export interface SavedResults {
  picks: PickResult[];
  nameMatches: SavedNameMatch[];
}

/** 회의 공유 상태 (단계를 하나씩 붙이며 늘림) */
export const MeetingState = Annotation.Root({
  tripId: Annotation<string>(),
  /** 회의 실행 id (mtg_). 1–2단계만 시험할 때는 없음 */
  meetingId: Annotation<string | null>(),
  /** LLM_REPLAY: 다시 쓸 지난 결과 (있으면 LLM을 부르지 않음, 없는 몫은 규칙) */
  saved: Annotation<SavedResults | null>(),
  conditions: Annotation<TripConditions | null>(),
  destination: Annotation<ResolvedDestination | null>(),
  members: Annotation<MemberInput[]>(),
  /** 2단계 결과: 후보 40곳·LLM용 한 줄 표·거른 이유 */
  pool: Annotation<RetrieveResult | null>(),
  /** 3단계 결과: AI 4명이 고른 곳 (사람마다 동시에 끝나는 대로 합쳐짐) */
  picks: Annotation<PickResult[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  /** 후보 보드 (명세서 board.updated의 data): 3단계 끝에 모으고, 4단계에서 반응·안건을 채워 덮어씀, 5단계에서 뺀 곳을 지움 */
  board: Annotation<Board | null>(),
  /** 5단계 사람 확인 요청 (4단계 안건 중 장소 안건). 비어 있으면 멈추지 않음 */
  reviewRequest: Annotation<ReviewRequest | null>(),
  /** 5단계 결과: 사람 4명이 남김·뺌을 정한 결과 (다수결, 같으면 방장) */
  reviewDecision: Annotation<ReviewDecision | null>(),
  /** 6단계 결과: A·B 두 안(경로·가는 길·식당)과 이 회의에서 부른 카카오 길찾기 수 */
  plans: Annotation<{ plans: PlanProposal[]; kakao: RouteMeter } | null>(),
});
export type MeetingStateType = typeof MeetingState.State;

export interface MeetingDeps {
  db: Db;
  /** 집중률 예측 호출기 (null이면 받아 둔 예측만 씀) */
  crowdClient: TourClient | null;
  today?: string;
  /** 3단계부터 씀 (null이면 규칙 고르기) */
  llm?: LlmClient | null;
  /** LLM 녹화·재생: 녹화된 같은 요청의 답은 부르지 않고 씀 (LLM 횟수에 세지 않음), 부른 답은 녹화 */
  recorder?: LlmRecorder | null;
  limits?: MeetingLimits;
  /** true면 LLM 요청·받는 글자·응답을 시험 화면용 이벤트로 보냄 */
  traceLlm?: boolean;
  /** 단계 저장 (LangGraph 체크포인트). 없으면 저장하지 않음 */
  checkpointer?: BaseCheckpointSaver;
  /** 6단계 길찾기 호출기 (카카오, 하루 한도 포함). null이면 저장된 길찾기만 쓰고 없는 구간은 '경로 정보 없음' */
  router?: RouteClient | null;
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
  if (rows.length < MIN_MEMBERS) throw new ApiError('NOT_ENOUGH_MEMBERS', `회의는 방장 포함 ${MIN_MEMBERS}명 이상이어야 함 (지금 ${rows.length}명)`);
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

/**
 * 2단계 후보 찾기 (코드). 장소·음식 넣기 규칙을 이름으로 못 찾을 때만 이름 맞추기 LLM 1회 (회의 실행 상한·하루 상한 안에서, 실행 중일 때만)
 * 2단계만 보는 시험 경로(upTo 'retrieve', 회의 id 없음)는 LLM을 부르지 않음. LLM_REPLAY면 지난 회의에서 맞춘 이름을 다시 씀
 */
async function retrieve(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const meetingId = state.meetingId;
  // 녹화된 같은 요청 → 지난 회의에서 맞춘 이름(LLM_REPLAY) → LLM 순서 (회의 실행 중일 때만)
  const matchNames =
    deps.limits && meetingId
      ? nameMatcher(deps.llm ?? null, () => reserveMeetingLlm(deps.db, meetingId, deps.limits!), {
          emit: deps.traceLlm ? emit : undefined,
          recorder: deps.recorder,
          saved: state.saved ? savedNameMatcher(state.saved.nameMatches) : undefined,
        })
      : null;
  const result = await retrieveCandidates(deps.db, {
    conditions: state.conditions!,
    destination: state.destination!,
    members: state.members,
    crowdClient: deps.crowdClient,
    today: deps.today,
    matchNames,
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

/**
 * 4단계 AI 반응: 사람마다 LLM 1회(4명 동시에, 생각 켬) — 그 사람이 쓴 말·바람을 그대로 들고 다른 AI가 고른 곳의 소개글을 읽어 👍⚠ (근거를 코드가 확인, ✕는 코드 규칙만)
 * 순서: 녹화된 같은 요청의 답(LLM 횟수에 세지 않음) → 회의 LLM 상한 안에서 부름(부른 답은 녹화). 못 쓰면 그 사람은 코드 반응만
 */
async function aiReactions(deps: MeetingDeps, state: MeetingStateType): Promise<Map<string, AiReaction[]>> {
  const meetingId = state.meetingId;
  if (!meetingId || !deps.limits) return new Map();
  const pairs = await Promise.all(
    state.members.map(async (m): Promise<[string, AiReaction[]]> => {
      const agentId = agentIdOf(m.memberId);
      const { req, rows, wishes } = reactRequest(m, state.pool!, state.board!);
      // 반응할 곳이 없거나 소개글로 볼 바람 글이 없는 사람은 부르지 않음 (10/19 예비 시험: 204명 중 12명이 바람 글 없음)
      if (!rows.length || !wishes.length) return [agentId, []];
      const replayed = await deps.recorder?.replay(req);
      if (replayed) return [agentId, acceptReactions(replayed, rows, wishes)];
      const llm = deps.llm;
      if (!llm || !(await reserveMeetingLlm(deps.db, meetingId, deps.limits!))) return [agentId, []];
      try {
        let value;
        if (deps.traceLlm && llm.streamJson) {
          emit({ type: 'llm.request', data: { agentId, purpose: 'react', try: 1, model: llm.name, system: req.system, input: req.input } });
          const out = await llm.streamJson(req, () => {});
          emit({ type: 'llm.response', data: { agentId, purpose: 'react', try: 1, model: out.model, ms: out.ms, usage: out.usage, text: out.text } });
          value = out.value;
        } else value = await llm.generateJson(req);
        await deps.recorder?.record(req, value);
        return [agentId, acceptReactions(value, rows, wishes)];
      } catch (err) {
        console.warn('4단계 AI 반응 LLM 실패, 코드 반응만 씀:', err instanceof Error ? err.message.slice(0, 200) : err);
        return [agentId, []];
      }
    }),
  );
  return new Map(pairs);
}

/** 4단계: 장소마다 4명의 반응(👍 ⚠ ✕) = 코드 규칙 + AI 반응(더 무거운 쪽), ⚠·✕가 붙은 곳을 회의 안건으로. 5단계에서 사람에게 물을 안건도 여기서 정함 */
async function react(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const board = reactBoard(state.board!, state.pool!, state.members, await aiReactions(deps, state));
  emit({ type: 'board.updated', data: board });
  return { board, reviewRequest: reviewRequestOf(board, state.pool!, state.members) };
}

/**
 * 5단계 사람 확인 (코드, LLM 0회): interrupt()로 회의를 멈추고(상태는 체크포인트에 저장) 사람 응답이 마감되면 Command({ resume })로 이어서 실행함
 * 이어서 실행하면 이 노드가 처음부터 다시 돌고 interrupt()가 마감 결과를 돌려주므로, interrupt() 앞에는 기록·전송 같은 부수 효과를 두지 않음
 */
async function review(state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const decision = interrupt<ReviewRequest, ReviewDecision>(state.reviewRequest!);
  const board = applyReview(state.board!, decision);
  emit({ type: 'review.closed', data: { meetingId: state.meetingId, ...decision } });
  emit({ type: 'board.updated', data: board });
  return { board, reviewDecision: decision };
}

/**
 * 6단계 동선 짜기 (코드, LLM 0회): 반응·사람 확인을 반영해 A·B 두 안을 짜고 구간마다 카카오 길찾기(도보·대중교통·택시·자차)를 붙여 plan.proposed로 보냄
 * 카카오는 회의마다 새로 세며(저장된 구간은 세지 않음) 한도·오류인 구간은 시간 없이 직선거리만 둠. 시각표·머무는 시간은 만들지 않음 (10/23 사용자 결정)
 */
async function schedule(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const kakao = newRouteMeter();
  const plans = await schedulePlans(deps.db, cachedRouter(deps.db, deps.router ?? null, kakao), {
    meetingId: state.meetingId,
    pool: state.pool!,
    board: state.board!,
    members: state.members,
    decision: state.reviewDecision ?? null,
    moveMode: state.conditions?.moveMode ?? 'transit',
  });
  for (const plan of plans) emit({ type: 'plan.proposed', data: plan });
  return { plans: { plans, kakao } };
}

/** 회의 그래프의 노드 이름과 단계 (시험 화면의 그래프 칸에 씀) */
export const MEETING_NODES = [
  { id: 'prepare', step: 1, label: '준비', kind: 'code' },
  { id: 'retrieve', step: 2, label: '후보 찾기', kind: 'code' },
  { id: 'pick', step: 3, label: '고르기 ×4', kind: 'llm' },
  { id: 'gather', step: 3, label: '후보 보드 모으기', kind: 'code' },
  { id: 'react', step: 4, label: '반응·안건', kind: 'llm' },
  { id: 'review', step: 5, label: '사람 확인', kind: 'human' },
  { id: 'schedule', step: 6, label: '동선 짜기 A·B', kind: 'code' },
] as const;

/** 실제 회의 그래프의 노드·연결과 단계별 규칙 값 (그래프를 만들기만 하고 실행하지 않음, 시험 화면이 규칙 값을 따로 적지 않게 함) */
export async function meetingGraphShape() {
  const graph = await buildMeetingGraph({ db: null as unknown as Db, crowdClient: null }).getGraphAsync();
  const meta = new Map<string, (typeof MEETING_NODES)[number]>(MEETING_NODES.map((n) => [n.id, n]));
  return {
    nodes: Object.keys(graph.nodes).map((id) => ({ id, step: meta.get(id)?.step ?? null, label: meta.get(id)?.label ?? id, kind: meta.get(id)?.kind ?? 'edge' })),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target, conditional: !!e.conditional })),
    rules: { react: REACT, schedule: SCHEDULE, route: ROUTE },
  };
}

/**
 * 회의 그래프: 준비 → 후보 찾기 → 고르기 ×4 (사람마다 서브그래프를 동시에 띄움, Send) → 후보 보드 → 반응·안건 → (고를 안건이 있으면) 사람 확인 → 동선 짜기 A·B
 * upTo 'retrieve'면 2단계에서 멈춤 (LLM 0회 시험용). 사람 확인은 멈췄다 이어서 실행하므로 체크포인트 저장(checkpointer)이 있어야 함
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
    recorder: deps.recorder,
    traceLlm: deps.traceLlm,
    reserveLlm: (meetingId) => (meetingId && deps.limits ? reserveMeetingLlm(deps.db, meetingId, deps.limits) : Promise.resolve(false)),
  });
  return base
    .addNode('pick', pickGraph)
    .addNode('gather', gather)
    .addNode('react', (s) => react(deps, s))
    .addNode('review', review)
    .addNode('schedule', (s) => schedule(deps, s))
    .addConditionalEdges(
      'retrieve',
      (s) =>
        s.members.map(
          (m) =>
            new Send('pick', {
              who: m,
              from: s.pool,
              meeting: s.meetingId,
              draft: null,
              tries: 0,
              calls: 0,
              blocked: false,
              savedPick: s.saved ? savedPickFor(s.saved.picks.find((p) => p.memberId === m.memberId), s.pool!) : null,
              picks: [],
            }),
        ),
      ['pick'],
    )
    .addEdge('pick', 'gather')
    .addEdge('gather', 'react')
    .addConditionalEdges('react', (s) => (s.reviewRequest?.items.length ? 'review' : 'schedule'), ['review', 'schedule'])
    .addEdge('review', 'schedule')
    .addEdge('schedule', END)
    .compile({ checkpointer: deps.checkpointer });
}
