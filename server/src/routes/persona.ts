import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { personas, trips } from '../db/schema.js';
import { type Access, type AccessKey, accessOf } from '../lib/access.js';
import { type AuthEnv, type Member, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { laneQueue } from '../lib/lane.js';
import { nowKst, todayKst } from '../lib/time.js';
import { parseBody } from '../lib/validate.js';
import type { LlmClient } from '../llm/client.js';
import { tunnelIp } from '../lib/rate-limit.js';
import { ipKey, releaseIpLlm, releaseLlmCard, reserveIpLlm, reserveLlmCard, tryConsumeLlmCall } from '../llm/usage.js';
import { ruleCategories } from '../meeting/categories.js';
import { DISLIKE_OPTIONS, LIKE_OPTIONS, PUBLIC_QUESTIONS } from '../persona/questions.js';
import { buildProfile, pickChips, readAnswers, sameAnswers, scoreTraits } from '../persona/score.js';
import type { PersonaAnswers } from '../persona/types.js';
import type { LlmRecorder } from '../llm/record.js';
import { type CardText, cardFromDraft, cardRequest, ruleCard } from '../persona/write.js';
import { memberColor } from './views.js';

export interface PersonaDeps {
  db: Db;
  llm: LlmClient | null;
  /** LLM 녹화·재생 (LLM_REPLAY): 녹화된 같은 요청의 답 → 같은 응답으로 AI가 만든 카드 순서로 다시 씀 */
  recorder?: LlmRecorder | null;
  llmDailyLimit: number;
  llmCardsPerMember: number;
  llmPerIpDaily: number;
  ipHashSecret: string;
  /** 접근 키 (ACCESS_KEYS): 있으면 키 없는 터널 요청은 LLM을 부르지 않고, 키를 낸 터널 요청은 IP 횟수 없이 live로 AI 카드를 만듦 */
  accessKeys?: readonly AccessKey[];
  /** 키를 낸 요청이 쓰는 LLM·녹화 (LLM_REPLAY=true여도 부름, ACCESS_LLM_REPLAY). 없으면 llm·recorder */
  live?: { llm: LlmClient; recorder: LlmRecorder } | null;
}

const answersBody = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        value: z.number().optional(),
        optionIds: z.array(z.string()).optional(),
        text: z.string().optional(),
      }),
    )
    .max(30),
});

/**
 * LLM_REPLAY: 같은 응답으로 AI가 만든 카드 중 가장 최근 것 (카드는 응답만으로 만들고 닉네임은 넣지 않으므로 같은 응답이면 같은 카드)
 * 1–12번 값이 같은 카드만 DB에서 읽고, 좋아요·싫어요·15번까지 같은지는 코드가 확인함
 */
async function savedCard(db: Db, answers: PersonaAnswers): Promise<CardText | null> {
  const rows = await db
    .select({ answers: personas.answers, title: personas.title, catchphrase: personas.catchphrase, tmi: personas.tmi, mustKeep: personas.mustKeep, wishes: personas.wishes })
    .from(personas)
    .where(and(eq(personas.source, 'llm'), sql`${personas.answers}->'scale' = ${JSON.stringify(answers.scale)}::jsonb`))
    .orderBy(desc(personas.updatedAt));
  const hit = rows.find((r) => sameAnswers(r.answers, answers));
  return hit ? { title: hit.title, catchphrase: hit.catchphrase, tmi: hit.tmi, mustKeep: hit.mustKeep, wishes: hit.wishes, source: 'llm' } : null;
}

/**
 * 설문 응답 → 성향·칩(규칙) → 카드 문장 → 회의용 숨은 값(규칙)
 * 카드 문장 순서: 녹화된 같은 요청의 답(LLM_REPLAY, LLM 횟수에 세지 않음) → 같은 응답으로 AI가 만든 카드(LLM_REPLAY) → LLM(부른 답은 녹화) → 규칙 카드
 */
async function makePersona(memberId: string, ip: string | null, answers: PersonaAnswers, access: Access | null, deps: PersonaDeps) {
  const { db, llmDailyLimit, llmCardsPerMember, llmPerIpDaily, ipHashSecret } = deps;
  // 접근 키가 있는 서버: 키를 낸 터널 요청은 키 몫의 LLM(IP 횟수 없음), 키 없는 터널 요청은 LLM 없음(녹화·규칙만)
  const keyed = access?.kind === 'key';
  const llm = keyed ? (deps.live?.llm ?? deps.llm) : access?.kind === 'none' ? null : deps.llm;
  const recorder = keyed ? (deps.live?.recorder ?? deps.recorder) : deps.recorder;
  const traits = scoreTraits(answers.scale);
  const chips = pickChips(traits);
  const done = (card: CardText) => ({ answers, traits, chips, ...card, profile: buildProfile(traits, answers, card.mustKeep) });
  const replaying = !!recorder && recorder.mode !== 'off';
  const categories = llm || replaying ? await ruleCategories(db) : [];
  const req = cardRequest(traits, answers, categories);
  const replayed = replaying ? await recorder.replay(req) : null;
  if (replayed) return done(cardFromDraft(replayed, answers, chips, categories));
  const saved = replaying ? await savedCard(db, answers) : null;
  if (saved) return done(saved);
  let card: CardText = ruleCard(chips, answers);
  // 개발 기간(llmPerIpDaily 0)에는 터널로 들어온 요청(팀원 앱)에 LLM을 쓰지 않음
  const tunnelBlocked = ip !== null && !keyed && llmPerIpDaily === 0;
  // AI 카드 확인 순서: 구성원당 llmCardsPerMember회 → 터널 IP당 하루 llmPerIpDaily회 → 서버 전체 하루 상한 (하나라도 막히면 규칙 카드)
  if (llm && !tunnelBlocked && (await reserveLlmCard(db, memberId, llmCardsPerMember))) {
    // 잡기·되돌리기가 같은 날짜 줄을 쓰도록 날짜를 한 번만 정함 (자정을 걸쳐 LLM을 기다려도 어긋나지 않게)
    const day = todayKst();
    const key = ip === null || keyed ? null : ipKey(ip, ipHashSecret);
    const ipReserved = key === null || (await reserveIpLlm(db, key, llmPerIpDaily, day));
    let written = false;
    if (ipReserved && (await tryConsumeLlmCall(db, llmDailyLimit, day))) {
      try {
        const draft = await llm.generateJson(req);
        await recorder?.record(req, draft);
        card = cardFromDraft(draft, answers, chips, categories);
        written = true;
      } catch (err) {
        console.warn('LLM 카드 작성 실패, 규칙 카드로 대신함:', err instanceof Error ? err.message : err);
      }
    }
    // AI 카드를 못 만들었으면 앞에서 잡은 횟수를 되돌림 (실제로 만든 AI 카드만 셈)
    if (!written) {
      await releaseLlmCard(db, memberId);
      if (ipReserved && key !== null) await releaseIpLlm(db, key, day);
    }
  }
  return done(card);
}

type PersonaRow = typeof personas.$inferSelect;

/** 카드 화면용 응답 (일정 계산용 profile·원래 응답은 보내지 않음) */
const personaView = (m: Member, p: PersonaRow) => ({
  memberId: m.id,
  nickname: m.nickname,
  color: memberColor(m),
  no: m.seat,
  title: p.title,
  catchphrase: p.catchphrase,
  tmi: p.tmi,
  chips: p.chips,
  traits: p.traits,
  likes: p.answers.likes.map((id) => LIKE_OPTIONS.find((o) => o.id === id)!).map(({ id, text, emoji }) => ({ id, text, emoji })),
  dislikes: p.answers.dislikes.map((id) => DISLIKE_OPTIONS.find((o) => o.id === id)!).map(({ id, text, emoji }) => ({ id, text, emoji })),
  mustKeep: p.mustKeep.map(({ type, label }) => ({ type, label })),
  wishes: p.wishes,
  source: p.source,
  updatedAt: nowKst(p.updatedAt),
});

/** 2번 묶음: 성향 질문·페르소나 (명세서 4.3) */
export function personaRoutes(deps: PersonaDeps) {
  const { db } = deps;
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);
  // 같은 구성원의 제출은 차례로 처리함 (동시에 두 번 내도 LLM은 한 번만 부르고, 두 번째는 같은 응답이면 앞 카드를 그대로 씀)
  const perMember = laneQueue();

  // 성향 문항 15개 (인증 불필요)
  r.get('/persona/questions', (c) => c.json({ questions: PUBLIC_QUESTIONS }));

  // 응답 제출 → 페르소나 생성. 회의가 시작되기 전까지는 다시 제출해 덮어쓸 수 있음
  r.post('/me/persona', auth, async (c) => {
    const me = c.get('member');
    const answers = readAnswers((await parseBody(c, answersBody)).answers);
    const preparing = async (q: Pick<Db, 'select'>, lock = false) => {
      const query = q.select({ status: trips.status }).from(trips).where(eq(trips.id, me.tripId));
      const [trip] = lock ? await query.for('update') : await query;
      if (trip.status !== 'preparing') throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작되어 페르소나를 바꿀 수 없음');
    };
    return perMember(me.id, async () => {
      await preparing(db);
      // 같은 응답으로 다시 제출하면 이전 카드를 그대로 돌려줌 (LLM을 다시 부르지 않음)
      const [prev] = await db.select().from(personas).where(eq(personas.memberId, me.id));
      if (prev && sameAnswers(prev.answers, answers)) return c.json({ persona: personaView(me, prev) }, 201);
      const keys = deps.accessKeys ?? [];
      const made = await makePersona(me.id, tunnelIp(c), answers, keys.length ? accessOf(c, keys) : null, deps);
      // 카드를 만드는 사이 회의가 시작됐으면 저장하지 않음 (여행 행을 잠가 회의 시작과 차례로 돎)
      const row = await db.transaction(async (tx) => {
        await preparing(tx, true);
        const [row] = await tx
          .insert(personas)
          .values({ memberId: me.id, ...made })
          .onConflictDoUpdate({ target: personas.memberId, set: { ...made, updatedAt: new Date() } })
          .returning();
        return row;
      });
      return c.json({ persona: personaView(me, row) }, 201);
    });
  });

  // 내 페르소나 조회
  r.get('/me/persona', auth, async (c) => {
    const me = c.get('member');
    const [row] = await db.select().from(personas).where(eq(personas.memberId, me.id));
    if (!row) throw new ApiError('NOT_FOUND', '아직 페르소나가 없음');
    return c.json({ persona: personaView(me, row) });
  });

  return r;
}
