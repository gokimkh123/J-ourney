import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { categories, llmIpUsage, llmRecords, llmUsage, members, personas, places, trips } from '../src/db/schema.js';
import { ApiError } from '../src/lib/errors.js';
import { buildProfile, pickChips, readAnswers, scoreTraits } from '../src/persona/score.js';
import { maskPersonal } from '../src/persona/write.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createLangChainLlm, inputTokenUpperBound, LlmTokenLimitError } from '../src/llm/client.js';
import type { MustKeepRule } from '../src/persona/types.js';
import { MINSU, SEOYEON, answersOf, call, createTestApp, fakeLlm } from './helpers.js';
import { hashAccessKey } from '../src/lib/access.js';

const MUST_KEEP = '해산물은 꼭 먹고, 밤 9시 전엔 숙소에 들어가고 싶어요';
const seoyeon = (text?: string) => answersOf(SEOYEON, ['like_spa', 'like_sea', 'like_cafe'], ['dislike_walk', 'dislike_crowd'], text);

/** LLM이 돌려줄 법한 카드 초안 (규칙 하나는 원문에 없는 인용이라 버려져야 함) */

/** 가짜 LLM 응답: 한 줄 규칙 목록을 실제 응답 형식(넣기·피하기·시간·예산… 칸)으로 나눔 */
const grouped = (rules: { type: string; label: string; quote: string; keyword: string; target: string; codes: string[]; start: string; end: string; amount: number }[]) => {
  const place = (t: string) => rules.filter((r) => r.type === t).map(({ label, quote, keyword, target, codes }) => ({ label, quote, keyword, target, codes }));
  const amount = (t: string) => rules.filter((r) => r.type === t).map(({ label, quote, amount }) => ({ label, quote, amount }));
  return {
    include: place('include'),
    avoid: place('avoid'),
    time: rules.filter((r) => r.type === 'time').map(({ label, quote, start, end }) => ({ label, quote, start, end })),
    budget: amount('budget'),
    steps: amount('steps'),
    move: amount('move'),
  };
};
const draft = (title = '온천 사랑 힐러') => ({
  title,
  catchphrase: '오후엔 온천에서 쉬어 가요~',
  tmi: '밤 9시면 눈꺼풀이 내려옴',
  mustKeep: grouped([
    { type: 'include', label: '해산물 먹기', quote: '해산물은 꼭 먹고', keyword: '해산물', target: 'food', codes: [], start: '', end: '', amount: 0 },
    { type: 'time', label: '밤 9시 전 숙소', quote: '밤 9시 전엔 숙소에 들어가고 싶어요', keyword: '', target: '', codes: [], start: '', end: '21:00', amount: 0 },
    { type: 'budget', label: '1인 10만 원', quote: '10만 원 이하로 해 주세요', keyword: '', target: '', codes: [], start: '', end: '', amount: 100000 },
  ]),
  wishes: [
    { label: '숙소에서 푹 쉬기', quote: '숙소에 들어가고 싶어요' },
    { label: '한적한 곳 위주', quote: '조용한 곳이 좋아요' },
  ],
});

const rule = (r: Partial<MustKeepRule>): MustKeepRule => ({ type: 'include', label: 'x', quote: 'x', keyword: null, start: null, end: null, amount: null, ...r });

describe('성향 점수와 칩 (규칙)', () => {
  it('서연형 응답은 느긋형·한적형·늦잠형, 나머지는 상관없음', () => {
    const traits = scoreTraits(readAnswers(seoyeon()).scale);
    expect(traits.map((t) => [t.key, t.score, t.label])).toEqual([
      ['plan', 5, '상관없음'],
      ['pace', 1.5, '느긋형'],
      ['vibe', 2, '한적형'],
      ['place', 4.5, '상관없음'],
      ['start', 2.5, '늦잠형'],
      ['budget', 5, '상관없음'],
    ]);
    expect(pickChips(traits).map((c) => c.label)).toEqual(['느긋형', '한적형', '늦잠형']);
  });

  it('두 문장에 모두 동의하면 상관없음, 3과 7은 경계에 포함됨', () => {
    const scale = (plus: number, minus: number) => ({ ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`q${i + 1}`, 5])), q1: plus, q7: minus });
    expect(scoreTraits(scale(8, 8))[0]).toMatchObject({ score: 5, level: 'neutral' });
    expect(scoreTraits(scale(3, 7))[0]).toMatchObject({ score: 3, level: 'low', label: '즉흥형' });
    expect(scoreTraits(scale(7, 3))[0]).toMatchObject({ score: 7, level: 'high', label: '계획형' });
  });

  it('칩이 동점이면 성향 순서대로, 모두 상관없음이면 뭐든 좋아', () => {
    const minsu = scoreTraits(readAnswers(answersOf(MINSU, ['like_food'], [])).scale);
    expect(pickChips(minsu).map((c) => c.label)).toEqual(['계획형', '부지런형', '명소형']);
    const flat = scoreTraits(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`q${i + 1}`, 5])));
    expect(pickChips(flat)).toEqual([{ label: '뭐든 좋아', emoji: '🍀' }]);
  });

  it('우선순위: 15번 > 14번 > 성향 기본값, 같은 종류 제한은 엄격한 쪽', () => {
    const answers = readAnswers(seoyeon());
    const traits = scoreTraits(answers.scale);
    const base = buildProfile(traits, answers, []);
    expect(base).toMatchObject({ placesPerDay: [2, 3], maxSteps: 10000, startTime: '10:30', maxCrowd: 80, freeMinutes: 30 });
    const ruled = buildProfile(traits, answers, [
      rule({ type: 'steps', amount: 8000 }),
      rule({ type: 'time', start: '06:00', end: '22:00' }),
      rule({ type: 'time', end: '21:00' }),
      rule({ type: 'include', keyword: '해산물' }),
    ]);
    expect(ruled).toMatchObject({ maxSteps: 8000, startTime: '06:00', endTime: '21:00', includes: ['해산물'] });
  });

  it('응답 검사: 미응답·보기 개수·없는 문항은 VALIDATION_ERROR', () => {
    const missing = seoyeon().filter((a) => a.questionId !== 'q3');
    expect(() => readAnswers(missing)).toThrowError(/q3/);
    expect(() => readAnswers(answersOf(SEOYEON, [], []))).toThrowError(/q13/);
    expect(() => readAnswers(answersOf(SEOYEON, ['like_sea'], ['dislike_walk', 'dislike_early', 'dislike_crowd', 'dislike_pricey']))).toThrowError(/q14/);
    expect(() => readAnswers([...seoyeon(), { questionId: 'q99', value: 1 }])).toThrowError(ApiError);
  });
});

describe('성향 질문·페르소나 API', () => {
  const setup = async (options: Parameters<typeof createTestApp>[0] = {}) => {
    const t = await createTestApp(options);
    const host = await call(t.app, 'POST', '/trips', { title: '부산 1박 2일', nickname: '민수' });
    return { ...t, host, token: host.body.token as string };
  };

  it('GET /persona/questions: 15문항, 채점 정보는 보내지 않음', async () => {
    const { app } = await createTestApp();
    const res = await call(app, 'GET', '/persona/questions');
    expect(res.body.questions).toHaveLength(15);
    expect(res.body.questions[0]).toMatchObject({ id: 'q1', type: 'scale', min: 0, max: 10 });
    expect(res.body.questions[0].trait).toBeUndefined();
    expect(res.body.questions[0].reverse).toBeUndefined();
  });

  it('15번의 연락처·식별번호는 가린 문장으로 LLM에 보냄 (금액·시각은 그대로)', async () => {
    // 가짜 번호는 조각을 이어 붙여 만듦 (원문 그대로 적으면 커밋 전 검사와 gitleaks가 개인정보로 막음)
    const phone = ['010', '1234', '5678'].join('-');
    const rrn = ['900101', '1234567'].join('-');
    expect(maskPersonal(`연락은 ${phone}, a.b+c@mail.co.kr 로 해 주세요`)).toBe('연락은 [전화번호], [이메일] 로 해 주세요');
    expect(maskPersonal(`${rrn} 계좌 1002345678901`)).toBe('[주민번호] 계좌 [번호]');
    expect(maskPersonal('1인 250000원, 밤 9시 전, 하루 1만 보')).toBe('1인 250000원, 밤 9시 전, 하루 1만 보');
    let sent: string | null = null;
    const llm = fakeLlm((input) => {
      sent = input.mustKeepText;
      return { ...draft(), mustKeep: grouped([{ type: 'include', label: '해산물 먹기', quote: '해산물은 꼭 먹고', keyword: '해산물', target: 'food', codes: [], start: '', end: '', amount: 0 }]) };
    });
    const { app, token } = await setup({ llm });
    const res = await call(app, 'POST', '/me/persona', { answers: seoyeon(`해산물은 꼭 먹고 싶어요. 연락처 ${phone.replaceAll('-', '')}`) }, token);
    expect(sent).toBe('해산물은 꼭 먹고 싶어요. 연락처 [전화번호]');
    expect(res.body.persona.mustKeep).toEqual([{ type: 'include', label: '해산물 먹기' }]);
  });

  it('LLM 카드: 종류 규칙은 분류표에 있는 코드만 받고, 없는 코드·모르는 target은 버림', async () => {
    let system = '';
    const llm = fakeLlm((_, __, sys) => {
      system = sys;
      return {
        ...draft(),
        mustKeep: grouped([
          { type: 'include', label: '온천 가기', quote: '온천은 꼭 가고', keyword: '온천', target: 'category', codes: ['EX050100', 'ZZ999999'], start: '', end: '', amount: 0 },
          { type: 'include', label: '카페 가기', quote: '카페도', keyword: '카페', target: 'category', codes: ['ZZ999999'], start: '', end: '', amount: 0 },
          { type: 'avoid', label: '시장 빼기', quote: '시장은 빼고', keyword: '시장', target: 'market', codes: [], start: '', end: '', amount: 0 },
        ]),
      };
    });
    const { app, db, token, host } = await setup({ llm });
    await db.insert(categories).values([
      { code: 'EX050100', name1: '체험관광', name2: '웰니스관광', name3: '온천 / 사우나 / 스파' },
      { code: 'AC010100', name1: '숙박', name2: '호텔', name3: '호텔' },
      { code: 'EX040100', name1: '체험관광', name2: '산사체험', name3: '템플스테이' },
      { code: 'C01120001', name1: '추천코스', name2: '가족코스', name3: '가족코스' },
    ]);
    // 분류표에는 후보가 될 장소가 쓰는 분류만 들어감 (템플스테이는 장소가 없어 빠짐)
    await db.insert(places).values([
      { contentId: 'c1', contentTypeId: 12, title: '시험온천', regionCode: '26', districtCode: '200', lcls1: 'EX', lcls3: 'EX050100', visible: true, listRaw: {} },
      { contentId: 'c2', contentTypeId: 32, title: '시험호텔', regionCode: '26', districtCode: '200', lcls1: 'AC', lcls3: 'AC010100', visible: true, listRaw: {} },
      { contentId: 'c3', contentTypeId: 25, title: '시험코스', regionCode: '26', districtCode: '200', lcls1: 'C0', lcls3: 'C01120001', visible: true, listRaw: {} },
    ]);
    const res = await call(app, 'POST', '/me/persona', { answers: seoyeon('온천은 꼭 가고 카페도, 시장은 빼고') }, token);
    expect(res.body.persona.mustKeep).toEqual([{ type: 'include', label: '온천 가기' }]); // 응답 형식은 그대로 (type·label)
    expect(system).toContain('[웰니스관광] EX050100 온천/사우나/스파');
    expect(system).toContain('AC010100'); // 숙박도 숙소 후보가 되므로 보냄 (예: 게스트하우스는 싫어요)
    expect(system).not.toContain('C01120001'); // 추천코스는 장소가 아니라 보내지 않음
    expect(system).not.toContain('EX040100');
    const [me] = await db.select().from(members).where(eq(members.tripId, host.body.trip.id));
    const [row] = await db.select().from(personas).where(eq(personas.memberId, me.id));
    expect(row.mustKeep[0]).toMatchObject({ keyword: '온천', target: 'category', codes: ['EX050100'] });
  });

  it('LLM 카드: 먹는 것의 제약(taste·피할 음식)은 규칙에도 바람에도 넣지 않음, 꼭 먹을 음식은 남김 (10/27 결정)', async () => {
    const text = '해산물은 못 먹고 회도 빼 주세요, 돼지국밥은 꼭';
    const llm = fakeLlm(() => ({
      ...draft(),
      mustKeep: grouped([
        { type: 'avoid', label: '해산물 빼기', quote: '해산물은 못 먹고', keyword: '해산물', target: 'taste', codes: [], start: '', end: '', amount: 0 },
        { type: 'avoid', label: '회 빼기', quote: '회도 빼 주세요', keyword: '회', target: 'food', codes: [], start: '', end: '', amount: 0 },
        { type: 'include', label: '돼지국밥 먹기', quote: '돼지국밥은 꼭', keyword: '돼지국밥', target: 'food', codes: [], start: '', end: '', amount: 0 },
      ]),
      wishes: [],
    }));
    const { app, token } = await setup({ llm });
    const res = await call(app, 'POST', '/me/persona', { answers: seoyeon(text) }, token);
    expect(res.body.persona.mustKeep).toEqual([{ type: 'include', label: '돼지국밥 먹기' }]);
    expect(res.body.persona.wishes).toEqual([]);
  });

  it('LLM 카드: 원문에 없는 인용의 조건은 버리고, 여행 상세에 유형명이 보임', async () => {
    const llm = fakeLlm(() => draft());
    const { app, host, token } = await setup({ llm });
    const res = await call(app, 'POST', '/me/persona', { answers: seoyeon(MUST_KEEP) }, token);
    expect(res.status).toBe(201);
    expect(res.body.persona).toMatchObject({ title: '온천 사랑 힐러', source: 'llm', no: 1, color: '#F97316' });
    expect(res.body.persona.chips.map((c: { label: string }) => c.label)).toEqual(['느긋형', '한적형', '늦잠형']);
    expect(res.body.persona.mustKeep).toEqual([
      { type: 'include', label: '해산물 먹기' },
      { type: 'time', label: '밤 9시 전 숙소' },
    ]);
    expect(res.body.persona.wishes).toEqual(['숙소에서 푹 쉬기']);
    expect(res.body.persona.profile).toBeUndefined();
    const detail = await call(app, 'GET', `/trips/${host.body.trip.id}`, undefined, token);
    expect(detail.body.members[0]).toMatchObject({ personaReady: true, title: '온천 사랑 힐러' });
  });

  it('LLM 1회 토큰 상한: 가장 긴 성향 요청도 입력 최대치 + 출력 상한이 99,900 안이고, 넘을 요청은 부르지 않음', async () => {
    let upper = 0;
    const llm = fakeLlm((input, _, system, schema) => {
      upper = inputTokenUpperBound(system, input, schema);
      return draft();
    });
    const { app, db, token } = await setup({ llm });
    // 분류표 205개 정도를 넣고, 15번은 최대 길이(200자)로 씀
    await db.insert(categories).values(Array.from({ length: 205 }, (_, i) => ({ code: `EX${String(i).padStart(6, '0')}`, name1: '체험관광', name2: '웰니스관광', name3: '온천 / 사우나 / 스파 시험 분류' })));
    await db.insert(places).values(Array.from({ length: 205 }, (_, i) => ({ contentId: `t${i}`, contentTypeId: 12, title: `시험${i}`, regionCode: '26', districtCode: '200', lcls1: 'EX', lcls3: `EX${String(i).padStart(6, '0')}`, visible: true, listRaw: {} })));
    await call(app, 'POST', '/me/persona', { answers: seoyeon('가'.repeat(200)) }, token);
    expect(config.llmCallTokenLimit).toBe(99_900);
    expect(upper).toBeGreaterThan(0);
    expect(upper + config.llmMaxOutputTokens).toBeLessThanOrEqual(config.llmCallTokenLimit);

    // 상한을 넘을 요청은 네트워크로 보내기 전에 막힘 (가짜 키, 실제 호출 없음)
    process.env.ANTHROPIC_API_KEY ??= 'test-not-a-real-key';
    const real = await createLangChainLlm({ provider: 'anthropic', model: 'claude-haiku-5-5', timeoutMs: 1000, callTokenLimit: 1000, maxOutputTokens: 900 });
    const { z } = await import('zod');
    await expect(real.generateJson({ system: '가'.repeat(100), input: {}, schema: z.object({ a: z.string() }), schemaName: 't' })).rejects.toBeInstanceOf(LlmTokenLimitError);
  });

  it('LLM이 실패하거나 하루 상한이면 규칙 카드로 대신함', async () => {
    const broken = await setup({ llm: fakeLlm(() => { throw new Error('timeout'); }) });
    const res = await call(broken.app, 'POST', '/me/persona', { answers: seoyeon(MUST_KEEP) }, broken.token);
    expect(res.body.persona).toMatchObject({ title: '느긋한 힐러', source: 'rule', mustKeep: [] });
    expect(res.body.persona.wishes).toEqual([MUST_KEEP.slice(0, 40)]);

    const llm = fakeLlm(() => draft());
    const capped = await setup({ llm, llmDailyLimit: 0 });
    const res2 = await call(capped.app, 'POST', '/me/persona', { answers: seoyeon() }, capped.token);
    expect(res2.body.persona.source).toBe('rule');
    expect(llm.calls).toBe(0);
  });

  it('LLM 문장이 길이를 넘으면 그 칸만 규칙 문장으로 대신함', async () => {
    const { app, token } = await setup({ llm: fakeLlm(() => draft('아주아주아주아주아주 긴 유형명')) });
    const res = await call(app, 'POST', '/me/persona', { answers: seoyeon() }, token);
    expect(res.body.persona).toMatchObject({ title: '느긋한 힐러', catchphrase: '오후엔 온천에서 쉬어 가요~', source: 'llm' });
  });

  it('제출 전 404, 토큰 없음 401, 미응답 400, 같은 응답은 이전 카드 그대로, 다른 응답은 덮어씀', async () => {
    const llm = fakeLlm((_, n) => draft(n === 1 ? '첫 번째 힐러' : '두 번째 힐러'));
    const { app, token } = await setup({ llm });
    expect((await call(app, 'GET', '/me/persona', undefined, token)).status).toBe(404);
    expect((await call(app, 'POST', '/me/persona', { answers: seoyeon() })).status).toBe(401);
    const missing = await call(app, 'POST', '/me/persona', { answers: seoyeon().filter((a) => a.questionId !== 'q3') }, token);
    expect(missing.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(missing.body.error.message).toContain('q3');
    const first = (await call(app, 'POST', '/me/persona', { answers: seoyeon() }, token)).body.persona;
    // 같은 응답(보기 순서만 다름)으로 다시 내면 이전 카드를 그대로 돌려주고 LLM을 부르지 않음
    const same = await call(app, 'POST', '/me/persona', { answers: answersOf(SEOYEON, ['like_cafe', 'like_sea', 'like_spa'], ['dislike_crowd', 'dislike_walk']) }, token);
    expect(same.status).toBe(201);
    expect(same.body.persona).toMatchObject({ title: '첫 번째 힐러', updatedAt: first.updatedAt });
    expect(llm.calls).toBe(1);
    await call(app, 'POST', '/me/persona', { answers: seoyeon('카페는 꼭 가고 싶어요') }, token);
    expect((await call(app, 'GET', '/me/persona', undefined, token)).body.persona.title).toBe('두 번째 힐러');
    expect(llm.calls).toBe(2);
  });

  it('AI 카드는 구성원당 2회까지, 그다음은 규칙 카드 (LLM이 실패한 회차는 세지 않음)', async () => {
    let failNext = true;
    const llm = fakeLlm(() => {
      if (failNext) {
        failNext = false;
        throw new Error('timeout');
      }
      return draft();
    });
    const { app, token } = await setup({ llm, llmCardsPerMember: 2 });
    let n = 0;
    const submit = async () => (await call(app, 'POST', '/me/persona', { answers: seoyeon(`조건 ${++n}`) }, token)).body.persona.source;
    expect([await submit(), await submit(), await submit(), await submit()]).toEqual(['rule', 'llm', 'llm', 'rule']);
    expect(llm.calls).toBe(3);
  });

  it('터널로 들어온 IP는 하루 2회까지 AI 카드, 이 PC에서 직접 보낸 요청은 세지 않음 (IP는 HMAC 값만 저장)', async () => {
    const llm = fakeLlm(() => draft());
    const { app, db } = await createTestApp({ llm, llmPerIpDaily: 2 });
    const tunnel = (ip: string) => ({ 'cf-connecting-ip': ip });
    const newMember = async () => (await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' })).body.token as string;
    const submit = async (headers?: Record<string, string>) =>
      (await call(app, 'POST', '/me/persona', { answers: seoyeon() }, await newMember(), headers)).body.persona.source;
    // 같은 IP에서는 구성원을 새로 만들어도 하루 2회까지
    expect([await submit(tunnel('203.0.113.7')), await submit(tunnel('203.0.113.7')), await submit(tunnel('203.0.113.7'))]).toEqual(['llm', 'llm', 'rule']);
    // 다른 IP와 이 PC에서 보낸 요청은 따로 셈
    expect(await submit(tunnel('198.51.100.9'))).toBe('llm');
    expect(await submit()).toBe('llm');
    expect(llm.calls).toBe(4);
    const rows = await db.select().from(llmIpUsage);
    expect(rows.map((r) => r.count).sort()).toEqual([1, 2]);
    expect(rows.every((r) => r.ipHash.length === 32 && !r.ipHash.includes('203.0.113.7'))).toBe(true);
  });

  it('접근 키가 있는 서버: 키 없는 터널 요청은 규칙 카드(LLM 0회), 키를 내면 IP 횟수 없이 AI 카드 (LLM_REPLAY=true여도)', async () => {
    const llm = fakeLlm(() => draft());
    const KEY = 'team-test-key-0123456789';
    const { app } = await createTestApp({ llm, llmReplay: true, llmPerIpDaily: 0, accessKeys: [{ label: 'team', quota: 1, hash: hashAccessKey(KEY) }] });
    const submit = async (text: string, headers: Record<string, string>) => {
      const token = (await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' })).body.token as string;
      return (await call(app, 'POST', '/me/persona', { answers: seoyeon(text) }, token, headers)).body.persona.source;
    };
    expect(await submit('첫 번째', { 'cf-connecting-ip': '203.0.113.7' })).toBe('rule');
    expect(llm.calls).toBe(0);
    expect(await submit('두 번째', { 'cf-connecting-ip': '203.0.113.7', 'x-access-key': KEY })).toBe('llm');
    expect(llm.calls).toBe(1);
  });

  it('LLM_REPLAY: 같은 응답으로 AI가 만든 카드가 있으면 다른 구성원에게도 그 카드를 쓰고(좋아요 순서 무관), 없으면 규칙 카드 (LLM 0회)', async () => {
    const llm = fakeLlm(() => draft());
    const { app, db } = await createTestApp({ llm });
    const replay = createApp({ db, rateLimitPerMinute: 1000, llm, llmReplay: true });
    const submit = async (target: typeof app, answers: unknown) => {
      const token = (await call(target, 'POST', '/trips', { title: '부산', nickname: '민수' })).body.token as string;
      return (await call(target, 'POST', '/me/persona', { answers }, token)).body.persona;
    };
    const made = await submit(app, seoyeon(MUST_KEEP));
    expect(made.source).toBe('llm');
    const reused = await submit(replay, answersOf(SEOYEON, ['like_cafe', 'like_spa', 'like_sea'], ['dislike_crowd', 'dislike_walk'], MUST_KEEP));
    expect(reused).toMatchObject({ source: 'llm', title: made.title, catchphrase: made.catchphrase, tmi: made.tmi, mustKeep: made.mustKeep });
    expect((await submit(replay, seoyeon('다른 바람'))).source).toBe('rule');
    expect(llm.calls).toBe(1);
  });

  it('녹화·재생: 실제로 만든 AI 카드의 답은 녹화되고, LLM_REPLAY면 같은 요청은 녹화된 답으로 만듦 (AI 카드 횟수·하루 횟수에 세지 않음)', async () => {
    const llm = fakeLlm(() => draft());
    const { app, db } = await createTestApp({ llm });
    const newMember = async (target: typeof app) => (await call(target, 'POST', '/trips', { title: '부산', nickname: '민수' })).body.token as string;
    const made = (await call(app, 'POST', '/me/persona', { answers: seoyeon(MUST_KEEP) }, await newMember(app))).body.persona;
    expect(made.source).toBe('llm');
    expect((await db.select().from(llmRecords)).map((r) => r.purpose)).toEqual(['persona_card']);
    await db.delete(personas); // 같은 응답의 AI 카드(지난 결과)로는 못 찾게 하고 녹화만 남김
    const replay = createApp({ db, rateLimitPerMinute: 1000, llm, llmReplay: 'only' });
    const token = await newMember(replay);
    const reused = (await call(replay, 'POST', '/me/persona', { answers: seoyeon(MUST_KEEP) }, token)).body.persona;
    expect(reused).toMatchObject({ source: 'llm', title: made.title, catchphrase: made.catchphrase, mustKeep: made.mustKeep });
    expect(llm.calls).toBe(1);
    const [usage] = await db.select().from(llmUsage);
    expect(usage.count).toBe(1);
    const [me] = await db.select().from(members).where(eq(members.id, reused.memberId));
    expect(me.llmCards).toBe(0);
  });

  it('개발 기간(IP당 0회)에는 터널 요청은 LLM 없이 규칙 카드, 이 PC 요청은 AI 카드', async () => {
    const llm = fakeLlm(() => draft());
    const { app, db } = await createTestApp({ llm, llmPerIpDaily: 0 });
    const submit = async (headers?: Record<string, string>) => {
      const token = (await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' })).body.token as string;
      return (await call(app, 'POST', '/me/persona', { answers: seoyeon() }, token, headers)).body.persona.source;
    };
    expect([await submit({ 'cf-connecting-ip': '203.0.113.7' }), await submit({ 'cf-connecting-ip': '198.51.100.9' })]).toEqual(['rule', 'rule']);
    expect(llm.calls).toBe(0);
    expect(await db.select().from(llmIpUsage)).toHaveLength(0);
    expect(await submit()).toBe('llm');
  });

  it('LLM이 실패한 회차는 IP 횟수에서도 빠짐', async () => {
    let failNext = true;
    const llm = fakeLlm(() => {
      if (failNext) {
        failNext = false;
        throw new Error('timeout');
      }
      return draft();
    });
    const { app } = await createTestApp({ llm, llmPerIpDaily: 1 });
    const submit = async () => {
      const token = (await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' })).body.token as string;
      return (await call(app, 'POST', '/me/persona', { answers: seoyeon() }, token, { 'cf-connecting-ip': '203.0.113.7' })).body.persona.source;
    };
    expect([await submit(), await submit(), await submit()]).toEqual(['rule', 'llm', 'rule']);
  });

  it('같은 구성원이 같은 응답을 동시에 여러 번 내면 차례로 처리해 LLM은 한 번만 부름 (나머지는 앞 카드)', async () => {
    const llm = fakeLlm(() => draft());
    const { app, token } = await setup({ llm, llmCardsPerMember: 2 });
    const results = await Promise.all(Array.from({ length: 6 }, () => call(app, 'POST', '/me/persona', { answers: seoyeon() }, token)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(new Set(results.map((r) => r.body.persona.title)).size).toBe(1);
    expect(results.every((r) => r.body.persona.source === 'llm')).toBe(true);
    expect(llm.calls).toBe(1);
  });

  it('같은 구성원이 다른 응답을 동시에 여러 번 내도 AI 카드는 상한까지만 만듦', async () => {
    const llm = fakeLlm(() => draft());
    const { app, token } = await setup({ llm, llmCardsPerMember: 2 });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call(app, 'POST', '/me/persona', { answers: seoyeon(`바다 보고 싶음 ${i}`) }, token)));
    expect(results.filter((r) => r.body.persona.source === 'llm')).toHaveLength(2);
    expect(llm.calls).toBe(2);
  });

  it('카드를 만드는 사이 회의가 시작되면 저장하지 않고 MEETING_IN_PROGRESS(409)', async () => {
    let db!: Awaited<ReturnType<typeof setup>>['db'];
    let tripId = '';
    // LLM이 답하는 사이 회의가 시작된 것처럼 여행 상태를 바꿈
    const llm = fakeLlm(async () => {
      await db.update(trips).set({ status: 'meeting' }).where(eq(trips.id, tripId));
      return draft();
    });
    const t = await setup({ llm });
    db = t.db;
    tripId = t.host.body.trip.id;
    const res = await call(t.app, 'POST', '/me/persona', { answers: seoyeon() }, t.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEETING_IN_PROGRESS');
    expect(await db.select().from(personas)).toHaveLength(0);
  });

  it('회의가 시작된 여행에서는 MEETING_IN_PROGRESS(409)', async () => {
    const { app, db, host, token } = await setup();
    await db.update(trips).set({ status: 'meeting' }).where(eq(trips.id, host.body.trip.id));
    const res = await call(app, 'POST', '/me/persona', { answers: seoyeon() }, token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEETING_IN_PROGRESS');
  });

  it('시연 모드: 페르소나를 마친 가상 구성원 3명이 자동 참여함', async () => {
    const { app } = await createTestApp();
    const demo = await call(app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
    const detail = await call(app, 'GET', `/trips/${demo.body.trip.id}`, undefined, demo.body.token);
    expect(detail.body.members.map((m: { nickname: string; personaReady: boolean; title: string | null }) => [m.nickname, m.personaReady, m.title])).toEqual([
      ['민수', false, null],
      ['지은', true, '반짝반짝 탐험가'],
      ['현우', true, '꼼꼼한 맛집 플래너'],
      ['서연', true, '느긋한 힐러'],
    ]);
    expect((await call(app, 'POST', `/invites/${demo.body.trip.inviteCode}/join`, { nickname: '다섯째' })).status).toBe(409);
  });

  it('요청 본문이 32KB를 넘으면 PAYLOAD_TOO_LARGE(413)', async () => {
    const { app } = await createTestApp();
    const res = await call(app, 'POST', '/trips', { title: '가'.repeat(40 * 1024), nickname: '민수' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('IP별 쓰기 요청 제한을 넘으면 RATE_LIMITED(429), 조회는 제한하지 않음', async () => {
    const { app } = await createTestApp({ rateLimitPerMinute: 2 });
    const make = () => call(app, 'POST', '/trips', { title: 't', nickname: 'n' });
    expect([(await make()).status, (await make()).status]).toEqual([201, 201]);
    const third = await make();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect((await call(app, 'GET', '/persona/questions')).status).toBe(200);
  });
});
