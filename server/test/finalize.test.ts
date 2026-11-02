import { describe, expect, it } from 'vitest';
import { FINALIZE, namePlans, namesRequest } from '../src/meeting/finalize.js';
import type { LlmRecorder } from '../src/llm/record.js';
import type { PlanProposal } from '../src/meeting/schedule.js';
import { fakeLlm } from './helpers.js';

/** 13단계 이름 짓기 시험용 두 안 (날짜별 들르는 곳만 씀) */
const plan = (label: 'A' | 'B', names: string[], shared: string[] = []) =>
  ({
    label,
    moveMode: 'transit',
    route: [
      {
        day: 1,
        stops: names.map((name, i) => ({ placeId: shared.includes(name) ? `plc_${name}` : `plc_${label}${i}`, kind: i === 1 ? 'food' : 'sight', name, category: i === 1 ? '한식' : null, night: i === names.length - 1 })),
      },
    ],
  }) as unknown as PlanProposal;
const PLANS = [plan('A', ['광안리해수욕장', '수변최고돼지국밥', '광안대교'], ['광안대교']), plan('B', ['국제시장', '신창국밥 본점', '광안대교'], ['광안대교'])];
const answer = (a: string, b: string, desc = (x: string) => `${x} 하루`) => ({ a: { pick: ['A1', 'A3'], name: a, desc: desc(a) }, b: { pick: ['B1'], name: b, desc: desc(b) } });
const always = async () => true;

describe('13단계 마무리: 두 안의 이름·설명 (AI 1회, 못 쓰면 A안·B안)', () => {
  it('입력은 코드가 만든 표 (번호=들르는 순서·종류·공식 분류) + 날 수·이동 수단 + 한쪽에만 있는 곳, 답은 그 안의 번호만 고름', () => {
    const req = namesRequest(PLANS);
    expect(req.input).toEqual({
      trip: { days: 1, move: '대중교통·택시' },
      plans: ['번호|날|종류|장소|분류', 'A1|1|관광|광안리해수욕장|-', 'A2|1|식당|수변최고돼지국밥|한식', 'A3|1|야경|광안대교|-', 'B1|1|관광|국제시장|-', 'B2|1|식당|신창국밥 본점|한식', 'B3|1|야경|광안대교|-'].join('\n'),
      only: { A: ['A1', 'A2'], B: ['B1', 'B2'] },
    });
    expect(req.schema.safeParse(answer('바다', '시장')).success).toBe(true);
    expect(req.schema.safeParse({ ...answer('바다', '시장'), b: { pick: ['A1'], name: '시장', desc: '시장 하루' } }).success).toBe(false); // B안은 B 번호만
  });

  it('AI 답을 그대로 보여 줌 · 두 이름이 같으면 B만 기본값 · 길이를 넘거나 칸 이름이 나오면 그 안만 기본값', async () => {
    const ok = await namePlans(PLANS, { llm: fakeLlm(() => answer('바다 따라 힐링', '시장 골목 먹방')), reserve: always });
    expect(ok).toMatchObject({ A: { title: '바다 따라 힐링', summary: '바다 따라 힐링 하루', source: 'llm' }, B: { title: '시장 골목 먹방', source: 'llm' }, llmCalls: 1 });
    const same = await namePlans(PLANS, { llm: fakeLlm(() => answer('부산 한 바퀴', '부산 한 바퀴')), reserve: always });
    expect(same).toMatchObject({ A: { title: '부산 한 바퀴', source: 'llm' }, B: { title: 'B안', summary: '', source: 'rule' } });
    const long = await namePlans(PLANS, { llm: fakeLlm(() => answer('가'.repeat(FINALIZE.titleHardMax + 1), 'plans 요약')), reserve: always });
    expect(long).toMatchObject({ A: { title: 'A안', source: 'rule' }, B: { title: 'B안', source: 'rule' } });
    // 표 번호(A1·B2)가 글에 나오면 그 칸만 기본값
    const ids = await namePlans(PLANS, { llm: fakeLlm(() => answer('A1 코스', '시장 코스', (x) => (x === '시장 코스' ? 'B1과 B3을 둘러보는 일정' : '해변 일정'))), reserve: always });
    expect(ids).toMatchObject({ A: { title: 'A안', source: 'rule' }, B: { title: '시장 코스', summary: '', source: 'llm' } });
  });

  it('AI가 두 번 실패하면 A안·B안 (2회) · 회의 AI 상한이면 부르지 않음', async () => {
    const broken = fakeLlm(() => {
      throw new Error('시험: 답 없음');
    });
    expect(await namePlans(PLANS, { llm: broken, reserve: always })).toEqual({
      A: { title: 'A안', summary: '', source: 'rule' },
      B: { title: 'B안', summary: '', source: 'rule' },
      llmCalls: FINALIZE.tries,
    });
    const capped = fakeLlm(() => answer('바다', '시장'));
    expect(await namePlans(PLANS, { llm: capped, reserve: async () => false })).toMatchObject({ A: { title: 'A안' }, llmCalls: 0 });
    expect(capped.calls).toBe(0);
  });

  it('녹화된 같은 요청이 있으면 AI 0회로 그 답을 씀', async () => {
    const llm = fakeLlm(() => answer('새 답', '새 답 2'));
    const recorder = { mode: 'only', replay: async () => answer('녹화 답', '녹화 답 2'), record: async () => {} } as unknown as LlmRecorder;
    expect(await namePlans(PLANS, { llm, recorder, reserve: always })).toMatchObject({ A: { title: '녹화 답' }, B: { title: '녹화 답 2' }, llmCalls: 0 });
    expect(llm.calls).toBe(0);
  });
});
