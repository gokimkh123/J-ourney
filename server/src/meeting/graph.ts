import { Annotation, type BaseCheckpointSaver, END, START, Send, StateGraph, getWriter, interrupt } from '@langchain/langgraph';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { MIN_MEMBERS, meetings, members, personas, regions, trips } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import type { LlmClient } from '../llm/client.js';
import type { LlmRecorder } from '../llm/record.js';
import { memberColor } from '../routes/views.js';
import type { TourClient } from '../tour/client.js';
import { areaMatcher, savedAreaMatcher } from './areas.js';
import { type SavedNameMatch, nameMatcher, savedNameMatcher } from './names.js';
import { type PickResult, boardOf, buildPickGraph, savedPickFor } from './pick.js';
import { type AiReaction, REACT, reactBoard } from './react.js';
import { acceptReactions, reactRequest } from './react-ai.js';
import { type Candidate, type MemberInput, type RetrieveResult, retrieveCandidates } from './retrieve.js';
import { applyReview, reviewRequestOf } from './review.js';
import { ROUTE, type RouteClient, type RouteMeter, cachedRouter, newRouteMeter } from './route.js';
import { type PlanProposal, type PlanStates, SCHEDULE, type ScheduleInput, revisePlans, schedulePlans } from './schedule.js';
import { type MeetingEventDraft, type MeetingLimits, agentIdOf, reserveMeetingLlm } from './runs.js';
import { EVAL, type EvalRound, type MemberEval, type PlanLabel, type RoundDiff, acceptEval, carryEval, concessionsOf, evalRequest, ruleEval } from './evaluate.js';
import { FINALIZE, type FinalPlan, namePlans } from './finalize.js';
import { type AppliedEdit, type Deliberation, MEETING_RULES, ROUNDS, type RoundRecord, decide, editKey, hurtBy, planDiff, requestsFor, revertPolish, roundMember, speakersOf, tallyOf } from './rounds.js';
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
  /**
   * 6·9단계 결과: A·B 두 안(경로·가는 길·식당)과 이 회의에서 부른 카카오 길찾기 수(라운드까지 누적), 두 안에 들어간 DB 보충 식당(7단계가 표시를 봄, 10/28 전 회의에는 없음),
   * 이 회의에서 못 쓴 길찾기 구간(9단계가 다시 짤 때 다시 부르지 않음, 10/29 전 회의에는 없음)
   */
  plans: Annotation<{ plans: PlanProposal[]; kakao: RouteMeter; extras?: Candidate[]; failedRoutes?: string[] } | null>(),
  /** 7·11단계 결과 (가장 최근 라운드): 사람마다 A·B 입장·이유·한마디·요청과 코드가 계산한 만족도 (코드가 고친 것·지난 평가를 그대로 둔 사람 포함) */
  evaluation: Annotation<EvalRound | null>(),
  // 8–12단계 라운드 고리 (10/29). 10/29 전에 사람 확인에서 멈춘 회의도 이어서 돌 수 있게 모두 기본값을 둠
  /** 지금 라운드 (평가할 때마다 1씩, 1라운드 = 7단계) */
  round: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  /** 라운드마다 누가 말했고 어떻게 평가·집계·수정했는지 (시험 화면용) */
  rounds: Annotation<RoundRecord[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** 6·9단계 두 안의 재료 (id만): 9단계 수정이 이어서 씀 */
  planStates: Annotation<PlanStates | null>({ reducer: (_a, b) => b, default: () => null }),
  /** 10단계 사회자가 정한 다음 라운드에 말할 사람 (memberId). null이면 모두 */
  speakers: Annotation<string[] | null>({ reducer: (_a, b) => b, default: () => null }),
  /** 지난 라운드에 바뀐 것 (9단계가 쓴 글, 다음 평가 입력의 changes) */
  changes: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** 지난 라운드의 9단계로 안마다 새로 들어온 곳·빠진 곳 (다음 평가 표의 '새로 들어옴'·사실 칸의 '바뀜') */
  diff: Annotation<RoundDiff | null>({ reducer: (_a, b) => b, default: () => null }),
  /** 라운드 고리 상태: 다음 일·끝난 까닭·반영한 요청·나아짐·다듬기 전 상태 */
  deliberation: Annotation<Deliberation | null>({ reducer: (_a, b) => b, default: () => null }),
  /** 13단계 결과: 두 안의 이름·설명·만족도·양보 (14단계 사람 선택으로 넘김) */
  final: Annotation<FinalPlan[] | null>({ reducer: (_a, b) => b, default: () => null }),
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
        // chips는 성향 카드(명세서 4.3)와 같은 { label, emoji } (10/28 명세서 대조)
        agents: rows.map(({ member, persona }) => ({ agentId: agentIdOf(member.id), memberId: member.id, nickname: member.nickname, title: persona.title, chips: persona.chips.map((c) => ({ label: c.label, emoji: c.emoji })), color: memberColor(member) })),
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
 * 2단계 후보 찾기 (코드). 꼭 지킬 것·꼭 피할 것의 장소·음식 이름이 있으면 이름 맞추기 LLM 1–3회 (규칙 6개씩 + 구 단위 여행의 여행지 밖 1회),
 * 지역 조건이 있으면 지역 맞추기 LLM 1–2회 (회의 실행 상한·하루 상한 안에서, 실행 중일 때만)
 * 2단계만 보는 시험 경로(upTo 'retrieve', 회의 id 없음)는 LLM을 부르지 않음. LLM_REPLAY면 지난 회의에서 맞춘 이름·지역을 다시 씀
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
  const matchAreas =
    deps.limits && meetingId
      ? areaMatcher(deps.llm ?? null, () => reserveMeetingLlm(deps.db, meetingId, deps.limits!), {
          emit: deps.traceLlm ? emit : undefined,
          recorder: deps.recorder,
          saved: state.saved ? savedAreaMatcher(state.saved.nameMatches) : undefined,
        })
      : null;
  const result = await retrieveCandidates(deps.db, {
    conditions: state.conditions!,
    destination: state.destination!,
    members: state.members,
    crowdClient: deps.crowdClient,
    today: deps.today,
    matchNames,
    matchAreas,
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
  const failed = new Set<string>();
  const { plans, extras, states } = await schedulePlans(deps.db, cachedRouter(deps.db, deps.router ?? null, kakao, undefined, failed), scheduleInput(state));
  for (const plan of plans) emit({ type: 'plan.proposed', data: plan });
  return { plans: { plans, kakao, extras, failedRoutes: [...failed] }, planStates: states };
}
const scheduleInput = (state: MeetingStateType): ScheduleInput => ({
  meetingId: state.meetingId,
  pool: state.pool!,
  board: state.board!,
  members: state.members,
  decision: state.reviewDecision ?? null,
  moveMode: state.conditions?.moveMode ?? 'transit',
});
/** 7단계 표에 쓰는 후보: 2단계 후보 + 두 안에 들어간 DB 보충 식당 */
const evalPool = (state: MeetingStateType) => {
  const extras = state.plans!.extras ?? [];
  return extras.length ? { ...state.pool!, candidates: [...state.pool!.candidates, ...extras] } : state.pool!;
};

/**
 * 7단계 평가 1라운드: 사람마다 LLM 1회(4명 동시에)로 A·B 입장·이유·한마디·고칠 요청을 받음 (10/27 계획 그림, 10/28 사용자 승인)
 * 답 형식표가 입장·요청 종류·표 번호를 보기로만 받게 하고, 코드는 그 고른 값과 사실표만 확인함 (AI가 쓴 글은 보여 주기만 함). 만족도는 코드가 계산
 * 순서: 녹화된 같은 요청의 답 → 회의 LLM 상한 안에서 부름(부른 답은 녹화) → 형식이 틀리면 1번 더 → 그래도 못 쓰면 규칙 평가
 */
async function evaluateOne(deps: MeetingDeps, state: MeetingStateType, m: MemberInputOf, extra: Parameters<typeof evalRequest>[5]): Promise<MemberEval> {
  const plans = state.plans!.plans;
  const minSat = state.conditions!.rules.aiMinSatisfaction;
  const { table, facts, req } = evalRequest(m, plans, evalPool(state), state.board!, state.reviewDecision ?? null, extra);
  const agentId = agentIdOf(m.memberId);
  const meetingId = state.meetingId;
  let calls = 0;
  let tried = false;
  let limited = false;
  // 녹화된 답을 먼저 모두 봄: 녹화할 때 첫 시도가 형식·오류로 실패해 두 번째 답만 녹화된 경우도 LLM 없이 다시 씀 (fill에서도 첫 시도를 다시 부르지 않음)
  for (let attempt = 1; attempt <= EVAL.tries; attempt++) {
    const replayed = await deps.recorder?.replay(req, attempt);
    if (replayed) return { ...acceptEval(m, plans, table, facts, replayed), llmCalls: 0, recorded: true };
  }
  let noLlm = false;
  for (let attempt = 1; attempt <= EVAL.tries; attempt++) {
    const llm = deps.llm;
    // AI 0번 모드(LLM_REPLAY): 녹화된 같은 요청이 없으면 규칙 평가 (2라운드부터는 입력에 지난 라운드 말·바뀐 것이 들어가 녹화가 거의 없음)
    if (!llm) {
      noLlm = true;
      break;
    }
    if (!meetingId || !deps.limits) break;
    // 회의 1번 AI 상한·하루 상한에 닿으면 규칙 평가 (시험 화면에 '상한'으로 보임)
    if (!(await reserveMeetingLlm(deps.db, meetingId, deps.limits))) {
      limited = true;
      break;
    }
    calls++;
    tried = true;
    try {
      let value;
      if (deps.traceLlm && llm.streamJson) {
        emit({ type: 'llm.request', data: { agentId, purpose: 'eval', try: attempt, model: llm.name, system: req.system, input: req.input } });
        const out = await llm.streamJson(req, () => {});
        emit({ type: 'llm.response', data: { agentId, purpose: 'eval', try: attempt, model: out.model, ms: out.ms, usage: out.usage, text: out.text } });
        value = out.value;
      } else value = await llm.generateJson(req);
      await deps.recorder?.record(req, value, attempt);
      return { ...acceptEval(m, plans, table, facts, value), llmCalls: calls };
    } catch (err) {
      console.warn(`7단계 평가 LLM ${attempt}번째 실패:`, err instanceof Error ? err.message.slice(0, 200) : err);
    }
  }
  const fixes: MemberEval['fixes'] = [
    ...(tried ? [{ kind: 'failed' as const, plan: null }] : []),
    ...(limited ? [{ kind: 'limit' as const, plan: null }] : []),
    ...(noLlm ? [{ kind: 'no_llm' as const, plan: null }] : []),
  ];
  return { ...ruleEval(m, plans, table, facts, minSat, fixes), llmCalls: calls };
}
type MemberInputOf = MeetingStateType['members'][number];

/** 라운드 기록용 두 안 요약 (날마다 장소 이름) */
const planBrief = (plans: readonly PlanProposal[]) => plans.map((p) => ({ label: p.label, planId: p.planId, version: p.version, days: p.route.map((d) => d.stops.map((s) => s.name)) }));
const voteOf = (e: MemberEval, v: MemberEval['plans'][number], round: number): MeetingEventDraft => ({
  type: 'vote.cast',
  data: { planId: v.planId, agentId: e.agentId, round, vote: v.stance === '찬성' ? 'yes' : 'no', score: v.score, stance: v.stance, reason: v.why, carried: !!e.carried },
});

/**
 * 7·11단계 평가 노드: round.started(이번에 말할 AI) → 말할 사람마다 평가(동시에, LLM) · 나머지는 지난 평가를 그대로 두고 만족도만 바뀐 일정으로 다시 계산(LLM 0)
 * → agent.message(말한 사람의 한마디) · vote.cast(모두, 안마다 찬성 yes·조건부·반대 no, 만족도, 지난 평가를 그대로 둔 사람은 carried)
 * 1라운드 입력은 7단계 그대로 (녹화가 맞도록 others·changes를 넣지 않음). 2라운드부터 다른 AI가 지난번에 한 말과 지난 라운드에 바뀐 것을 넣음
 */
async function evaluate(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const round = (state.round ?? 0) + 1;
  const prev = round > 1 ? state.evaluation : null;
  const speakers = prev && state.speakers ? state.speakers : state.members.map((m) => m.memberId);
  emit({ type: 'round.started', data: { round, maxRounds: state.conditions!.rules.maxRounds, speakers: speakers.map(agentIdOf) } });
  const plans = state.plans!.plans;
  const seen = new Map((state.rounds.at(-1)?.plans ?? []).map((p) => [p.label, p.version]));
  const changed = new Set<PlanLabel>(plans.filter((p) => seen.has(p.label) && seen.get(p.label) !== p.version).map((p) => p.label));
  const lastSaid = new Map((prev?.members ?? []).map((e) => [e.memberId, e.comment]));
  const members = await Promise.all(
    state.members.map((m) => {
      const before = prev?.members.find((e) => e.memberId === m.memberId);
      if (prev && before && !speakers.includes(m.memberId)) {
        const { table, facts } = evalRequest(m, plans, evalPool(state), state.board!, state.reviewDecision ?? null);
        return carryEval(m, before, plans, table, facts, changed);
      }
      const others = state.members.filter((o) => o.memberId !== m.memberId).map((o) => `${o.title}: ${lastSaid.get(o.memberId) || '-'}`);
      return evaluateOne(deps, state, m, prev ? { round, others, changes: state.changes, diff: state.diff } : { round });
    }),
  );
  for (const e of members) {
    if (!e.carried) emit({ type: 'agent.message', data: { agentId: e.agentId, round, text: e.comment } });
    for (const v of e.plans) emit(voteOf(e, v, round));
  }
  const record: RoundRecord = { round, speakers, plans: planBrief(plans), members: members.map(roundMember), tally: [], next: null, outcome: null, applied: [], hurt: [], reverted: [], restored: [] };
  return { round, evaluation: { round, members }, rounds: [...state.rounds, record] };
}

/** 라운드 기록의 마지막(지금 라운드)만 고침 */
const withLast = (rounds: readonly RoundRecord[], patch: Partial<RoundRecord>) => rounds.map((r, i) => (i === rounds.length - 1 ? { ...r, ...patch } : r));

/**
 * 8·12단계 집계 (코드, LLM 0회): 안마다 구성원 만족도 평균 ≥ 기준(aiMinSatisfaction)이면 통과 → 다음 일(수정·다듬기·끝)을 정함 (rounds.decide)
 * 다듬어 본 라운드면 다듬은 안의 평균이 다듬기 전보다 떨어졌을 때 그 안을 다듬기 전으로 되돌리고 끝냄 (10/19 사용자 결정).
 * 되돌린 안은 plan.proposed(version + 1, 내용은 다듬기 전)와 그 안의 vote.cast(다듬기 전 점수, carried)를 다시 보냄
 */
async function tally(state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const rules = state.conditions!.rules;
  const evaluation = state.evaluation!;
  const t = tallyOf(evaluation, state.plans!.plans, rules.aiMinSatisfaction);
  const snap = state.deliberation?.polish;
  if (!snap) {
    const polishable = requestsFor('polish', evaluation, t, new Set(state.deliberation?.tried ?? [])).length > 0;
    const d = decide(state.deliberation ?? null, t, state.round, rules.maxRounds, polishable);
    return { deliberation: d, rounds: withLast(state.rounds, { tally: t, next: d.next, outcome: d.outcome }) };
  }
  // 다듬어 본 라운드: 평균이 떨어진 안은 되돌리고, 다듬지 않은 안은 다듬기 전 평가를 씀 → 끝 (바꾼 상태 칸만 돌려줌, 체크포인트가 커지지 않게)
  const back = revertPolish(snap, { plans: state.plans!.plans, extras: state.plans!.extras ?? [], states: state.planStates! }, evaluation, t);
  const d: Deliberation = { ...state.deliberation!, next: 'end', outcome: 'passed', polish: null, reverted: back.reverted };
  if (!back.restored.length) return { deliberation: d, rounds: withLast(state.rounds, { tally: t, next: d.next, outcome: d.outcome }) };
  for (const p of back.plans.filter((x) => back.reverted.includes(x.label))) emit({ type: 'plan.proposed', data: p });
  for (const e of back.evaluation.members) for (const v of e.plans.filter((x) => back.restored.includes(x.plan))) emit(voteOf({ ...e, carried: true }, v, state.round));
  const final = tallyOf(back.evaluation, back.plans, rules.aiMinSatisfaction);
  return {
    plans: { ...state.plans!, plans: back.plans, extras: back.extras },
    planStates: back.states,
    evaluation: back.evaluation,
    deliberation: d,
    rounds: withLast(state.rounds, { tally: final, next: d.next, outcome: d.outcome, reverted: back.reverted, restored: back.restored, members: back.evaluation.members.map(roundMember), plans: planBrief(back.plans) }),
  };
}

/**
 * 9단계 수정 (코드, LLM 0회): 집계가 정한 요청을 그 안의 만족도가 낮은 사람 것부터 반영하고, 바뀐 안만 6단계 계산(카카오 길찾기)으로 다시 짜 plan.proposed(version + 1)로 보냄
 * 반영한 것이 없으면 끝 (수정: no_change, 다듬기: 다듬지 않고 passed). 다듬기면 다듬기 전 상태를 남겨 집계가 되돌릴 수 있게 함
 */
async function revise(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const d = state.deliberation!;
  const mode = d.next === 'polish' ? 'polish' : 'revise';
  const last = state.rounds.at(-1)!;
  const before = state.plans!;
  const edits = requestsFor(mode, state.evaluation!, last.tally, new Set(d.tried));
  if (!edits.length) {
    // 반영할 요청이 없으면 재료를 다시 읽지 않고 끝 (수정: no_change, 다듬기: 다듬지 않고 passed)
    const outcome = mode === 'polish' ? 'passed' : 'no_change';
    return { deliberation: { ...d, next: 'end', outcome }, rounds: withLast(state.rounds, { next: 'end', outcome }) };
  }
  // 카카오 수는 회의 전체로 이어서 셈 (회의당 상한 ROUTE.perMeeting이 라운드마다 처음부터 다시 시작하지 않게), 못 쓴 구간은 다시 부르지 않음
  const kakao: RouteMeter = { ...before.kakao, calls: { ...before.kakao.calls } };
  const failed = new Set(before.failedRoutes ?? []);
  const out = await revisePlans(deps.db, cachedRouter(deps.db, deps.router ?? null, kakao, undefined, failed), scheduleInput(state), { plans: before.plans, states: state.planStates! }, edits, {
    changesPerPlan: ROUNDS.changesPerPlan,
  });
  const applied: AppliedEdit[] = edits.map((e, i) => ({ ...out.results[i], by: e.by, type: e.type, placeId: e.placeId, toId: e.toId }));
  const tried = [...d.tried, ...edits.filter((_, i) => out.results[i].applied).map(editKey)];
  if (!out.changed.length) {
    const outcome = mode === 'polish' ? 'passed' : 'no_change';
    return { deliberation: { ...d, tried, next: 'end', outcome }, rounds: withLast(state.rounds, { applied, next: 'end', outcome }) };
  }
  for (const p of out.plans.filter((x) => out.changed.includes(x.label))) emit({ type: 'plan.proposed', data: p });
  const polish =
    mode === 'polish'
      ? { averages: Object.fromEntries(last.tally.map((x) => [x.plan, x.average])), plans: before.plans, states: state.planStates!, extras: before.extras ?? [], evaluation: state.evaluation!, touched: out.changed }
      : null;
  return {
    plans: { plans: out.plans, kakao, extras: out.extras, failedRoutes: [...failed] },
    planStates: out.states,
    changes: applied.filter((a) => a.applied).map((a) => a.note),
    diff: planDiff(before.plans, out.plans),
    deliberation: { ...d, tried, polish },
    rounds: withLast(state.rounds, { applied, hurt: hurtBy(before.plans, out.plans) }),
  };
}

/**
 * 13단계 마무리: 두 안에 이름·한 줄 설명(AI 1회, 못 쓰면 'A안'·'B안')을 붙이고, 마지막 라운드의 만족도와 사람마다의 양보 내역(코드)을 모아 meeting.agreed로 알림
 * 이 뒤 사람이 A·B 중 고름 (14단계, 회의 실행기가 여행의 일정 표를 엶)
 */
async function finalize(deps: MeetingDeps, state: MeetingStateType): Promise<Partial<MeetingStateType>> {
  const plans = state.plans!.plans;
  const ev = state.evaluation!;
  const meetingId = state.meetingId;
  const names = await namePlans(plans, {
    llm: deps.llm ?? null,
    recorder: deps.recorder,
    reserve: () => (meetingId && deps.limits ? reserveMeetingLlm(deps.db, meetingId, deps.limits) : Promise.resolve(false)),
    emit: deps.traceLlm ? emit : undefined,
  });
  const t = tallyOf(ev, plans, state.conditions!.rules.aiMinSatisfaction);
  const gave = new Map(state.members.map((m) => [m.memberId, concessionsOf(m, plans, evalPool(state), state.board!, state.reviewDecision ?? null)]));
  const final: FinalPlan[] = plans.map((p) => {
    const tally = t.find((x) => x.plan === p.label)!;
    return {
      planId: p.planId,
      label: p.label,
      version: p.version,
      title: names[p.label].title,
      summary: names[p.label].summary,
      source: names[p.label].source,
      satisfaction: {
        average: tally.average,
        passed: tally.passed,
        members: ev.members.map((e) => {
          const v = e.plans.find((x) => x.plan === p.label)!;
          return { memberId: e.memberId, agentId: e.agentId, score: v.score, stance: v.stance };
        }),
      },
      concessions: state.members.map((m) => {
        const c = gave.get(m.memberId)!.find((x) => x.plan === p.label)!;
        return { memberId: m.memberId, mustMissed: c.mustMissed, warned: c.warned };
      }),
    };
  });
  const [row] = meetingId ? await deps.db.select({ startedAt: meetings.startedAt }).from(meetings).where(eq(meetings.id, meetingId)) : [];
  emit({
    type: 'meeting.agreed',
    data: {
      meetingId,
      outcome: state.deliberation?.outcome ?? null,
      rounds: state.round,
      durationSec: row ? Math.round((Date.now() - row.startedAt.getTime()) / 1000) : null,
      proposalCount: plans.reduce((a, p) => a + p.version, 0),
      editCount: state.rounds.reduce((a, r) => a + r.applied.filter((x) => x.applied).length, 0),
      plans: final,
    },
  });
  return { final };
}

/** 10단계 사회자 (코드, LLM 0회): 다음 라운드에 다시 평가할 AI를 정함 (다음 round.started의 speakers로 알림) */
function moderate(state: MeetingStateType): Partial<MeetingStateType> {
  const last = state.rounds.at(-1)!;
  const appliedBy = new Set(last.applied.filter((a) => a.applied).map((a) => a.by));
  return { speakers: speakersOf(state.deliberation?.polish ? 'polish' : 'revise', state.members, state.evaluation!, last.tally, last.hurt, appliedBy) };
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
  { id: 'evaluate', step: 7, label: '평가 ×4 (2–5라운드는 11단계)', kind: 'llm' },
  { id: 'tally', step: 8, label: '집계 (2–5라운드는 12단계)', kind: 'code' },
  { id: 'revise', step: 9, label: '수정', kind: 'code' },
  { id: 'moderate', step: 10, label: '사회자', kind: 'code' },
  { id: 'finalize', step: 13, label: '마무리 (이름·만족도·양보)', kind: 'llm' },
] as const;

/**
 * 회의 한 번 실행에서 거치는 노드 수 상한 (LangGraph recursionLimit, 기본 25): 1–8단계 노드 + 라운드마다 4개(집계·수정·사회자·평가) × 최대 라운드 + 여유
 * 사람 확인 없이 5라운드까지 가면 24걸음이라 기본값 25에 거의 닿음 (노드를 하나만 더해도 회의가 실패로 끝나므로 계산해 넘김)
 */
export const MEETING_STEP_LIMIT = MEETING_NODES.length + ROUNDS.nodesPerRound * MEETING_RULES.maxRounds.max + ROUNDS.stepsMargin;

/** 실제 회의 그래프의 노드·연결과 단계별 규칙 값 (그래프를 만들기만 하고 실행하지 않음, 시험 화면이 규칙 값을 따로 적지 않게 함) */
export async function meetingGraphShape() {
  const graph = await buildMeetingGraph({ db: null as unknown as Db, crowdClient: null }).getGraphAsync();
  const meta = new Map<string, (typeof MEETING_NODES)[number]>(MEETING_NODES.map((n) => [n.id, n]));
  return {
    nodes: Object.keys(graph.nodes).map((id) => ({ id, step: meta.get(id)?.step ?? null, label: meta.get(id)?.label ?? id, kind: meta.get(id)?.kind ?? 'edge' })),
    edges: graph.edges.map((e) => ({ from: e.source, to: e.target, conditional: !!e.conditional })),
    rules: { react: REACT, schedule: SCHEDULE, route: ROUTE, evaluate: EVAL, rounds: ROUNDS, finalize: FINALIZE },
  };
}

/**
 * 회의 그래프: 준비 → 후보 찾기 → 고르기 ×4 (사람마다 서브그래프를 동시에 띄움, Send) → 후보 보드 → 반응·안건 → (고를 안건이 있으면) 사람 확인 → 동선 짜기 A·B
 * → 평가 → 집계 → (통과 못 한 안이 있거나 다듬을 요청이 남으면) 수정 → 사회자 → 평가 … (최대 라운드까지) → 마무리(이름·만족도·양보) → 끝 (사람이 A·B 중 고름)
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
    .addNode('evaluate', (s) => evaluate(deps, s))
    .addNode('tally', tally)
    .addNode('revise', (s) => revise(deps, s))
    .addNode('moderate', moderate)
    .addNode('finalize', (s) => finalize(deps, s))
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
    .addEdge('schedule', 'evaluate')
    .addEdge('evaluate', 'tally')
    .addConditionalEdges('tally', (s) => (s.deliberation?.next === 'end' ? 'finalize' : 'revise'), ['revise', 'finalize'])
    .addConditionalEdges('revise', (s) => (s.deliberation?.next === 'end' ? 'finalize' : 'moderate'), ['moderate', 'finalize'])
    .addEdge('moderate', 'evaluate')
    .addEdge('finalize', END)
    .compile({ checkpointer: deps.checkpointer });
}
