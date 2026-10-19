import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { personas, trips } from '../db/schema.js';
import { type AuthEnv, type Member, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { nowKst } from '../lib/time.js';
import { parseBody } from '../lib/validate.js';
import type { LlmClient } from '../llm/client.js';
import { tunnelIp } from '../lib/rate-limit.js';
import { ipKey, releaseIpLlm, releaseLlmCard, reserveIpLlm, reserveLlmCard, tryConsumeLlmCall } from '../llm/usage.js';
import { ruleCategories } from '../meeting/categories.js';
import { DISLIKE_OPTIONS, LIKE_OPTIONS, PUBLIC_QUESTIONS } from '../persona/questions.js';
import { buildProfile, pickChips, readAnswers, sameAnswers, scoreTraits } from '../persona/score.js';
import type { PersonaAnswers } from '../persona/types.js';
import { type CardText, llmCard, ruleCard } from '../persona/write.js';
import { memberColor } from './views.js';

export interface PersonaDeps {
  db: Db;
  llm: LlmClient | null;
  llmDailyLimit: number;
  llmCardsPerMember: number;
  llmPerIpDaily: number;
  ipHashSecret: string;
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

/** 설문 응답 → 성향·칩(규칙) → 카드 문장(LLM, 실패 시 규칙) → 회의용 숨은 값(규칙) */
async function makePersona(memberId: string, ip: string | null, answers: PersonaAnswers, deps: PersonaDeps) {
  const { db, llm, llmDailyLimit, llmCardsPerMember, llmPerIpDaily, ipHashSecret } = deps;
  const traits = scoreTraits(answers.scale);
  const chips = pickChips(traits);
  let card: CardText = ruleCard(chips, answers);
  // 개발 기간(llmPerIpDaily 0)에는 터널로 들어온 요청(팀원 앱)에 LLM을 쓰지 않음
  const tunnelBlocked = ip !== null && llmPerIpDaily === 0;
  // AI 카드 확인 순서: 구성원당 llmCardsPerMember회 → 터널 IP당 하루 llmPerIpDaily회 → 서버 전체 하루 상한 (하나라도 막히면 규칙 카드)
  if (llm && !tunnelBlocked && (await reserveLlmCard(db, memberId, llmCardsPerMember))) {
    const key = ip === null ? null : ipKey(ip, ipHashSecret);
    const ipReserved = key === null || (await reserveIpLlm(db, key, llmPerIpDaily));
    let written = false;
    if (ipReserved && (await tryConsumeLlmCall(db, llmDailyLimit))) {
      try {
        card = await llmCard(llm, traits, chips, answers, await ruleCategories(db));
        written = true;
      } catch (err) {
        console.warn('LLM 카드 작성 실패, 규칙 카드로 대신함:', err instanceof Error ? err.message : err);
      }
    }
    // AI 카드를 못 만들었으면 앞에서 잡은 횟수를 되돌림 (실제로 만든 AI 카드만 셈)
    if (!written) {
      await releaseLlmCard(db, memberId);
      if (ipReserved && key !== null) await releaseIpLlm(db, key);
    }
  }
  return { answers, traits, chips, ...card, profile: buildProfile(traits, answers, card.mustKeep) };
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

  // 성향 문항 15개 (인증 불필요)
  r.get('/persona/questions', (c) => c.json({ questions: PUBLIC_QUESTIONS }));

  // 응답 제출 → 페르소나 생성. 회의가 시작되기 전까지는 다시 제출해 덮어쓸 수 있음
  r.post('/me/persona', auth, async (c) => {
    const me = c.get('member');
    const answers = readAnswers((await parseBody(c, answersBody)).answers);
    const [trip] = await db.select({ status: trips.status }).from(trips).where(eq(trips.id, me.tripId));
    if (trip.status !== 'preparing') throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작되어 페르소나를 바꿀 수 없음');
    // 같은 응답으로 다시 제출하면 이전 카드를 그대로 돌려줌 (LLM을 다시 부르지 않음)
    const [prev] = await db.select().from(personas).where(eq(personas.memberId, me.id));
    if (prev && sameAnswers(prev.answers, answers)) return c.json({ persona: personaView(me, prev) }, 201);
    const made = await makePersona(me.id, tunnelIp(c), answers, deps);
    const [row] = await db
      .insert(personas)
      .values({ memberId: me.id, ...made })
      .onConflictDoUpdate({ target: personas.memberId, set: { ...made, updatedAt: new Date() } })
      .returning();
    return c.json({ persona: personaView(me, row) }, 201);
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
