import { describe, expect, it } from 'vitest';
import { FINALIZE, namePlans, namesRequest } from '../src/meeting/finalize.js';
import type { LlmRecorder } from '../src/llm/record.js';
import type { PlanProposal } from '../src/meeting/schedule.js';
import { fakeLlm } from './helpers.js';

/** 13단계 이름 짓기 시험용 두 안 (날짜별 들르는 곳만 씀) */
const plan = (label: 'A' | 'B', names: string[]) =>
  ({
    label,
    route: [{ day: 1, stops: names.map((name, i) => ({ kind: i === 1 ? 'food' : 'sight', name, night: i === names.length - 1 })) }],
  }) as unknown as PlanProposal;
const PLANS = [plan('A', ['광안리해수욕장', '수변최고돼지국밥', '광안대교']), plan('B', ['국제시장', '신창국밥 본점', '용두산공원'])];
const answer = (a: string, b: string) => ({ a: { name: a, desc: `${a} 하루` }, b: { name: b, desc: `${b} 하루` } });
const always = async () => true;

describe('13단계 마무리: 두 안의 이름·설명 (AI 1회, 못 쓰면 A안·B안)', () => {
  it('입력은 코드가 만든 날짜별 표 (식당 🍚·야경 🌃 표시)', () => {
    expect(namesRequest(PLANS).input).toEqual({ plans: { A: '1일째: 광안리해수욕장 → 🍚수변최고돼지국밥 → 🌃광안대교', B: '1일째: 국제시장 → 🍚신창국밥 본점 → 🌃용두산공원' } });
  });

  it('AI 답을 그대로 보여 줌 · 두 이름이 같으면 B만 기본값 · 길이를 넘거나 칸 이름이 나오면 그 안만 기본값', async () => {
    const ok = await namePlans(PLANS, { llm: fakeLlm(() => answer('바다 따라 힐링', '시장 골목 먹방')), reserve: always });
    expect(ok).toMatchObject({ A: { title: '바다 따라 힐링', summary: '바다 따라 힐링 하루', source: 'llm' }, B: { title: '시장 골목 먹방', source: 'llm' }, llmCalls: 1 });
    const same = await namePlans(PLANS, { llm: fakeLlm(() => answer('부산 한 바퀴', '부산 한 바퀴')), reserve: always });
    expect(same).toMatchObject({ A: { title: '부산 한 바퀴', source: 'llm' }, B: { title: 'B안', summary: '', source: 'rule' } });
    const long = await namePlans(PLANS, { llm: fakeLlm(() => answer('가'.repeat(FINALIZE.titleHardMax + 1), 'plans 요약')), reserve: always });
    expect(long).toMatchObject({ A: { title: 'A안', source: 'rule' }, B: { title: 'B안', source: 'rule' } });
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
