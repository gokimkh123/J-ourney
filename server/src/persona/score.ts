import { ApiError } from '../lib/errors.js';
import {
  DISLIKE_OPTIONS,
  DISLIKE_SELECT,
  DISLIKES_ID,
  LIKE_OPTIONS,
  LIKE_SELECT,
  LIKES_ID,
  MUST_KEEP_ID,
  MUST_KEEP_MAX_LENGTH,
  NEUTRAL_LABEL,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_QUESTIONS,
  TRAITS,
} from './questions.js';
import type { Chip, MustKeepRule, PersonaAnswers, PersonaProfile, TraitLevel, TraitResult } from './types.js';

/** 판정 기준점: 이 값 이하면 low, BAND_HIGH 이상이면 high (시범 조사 후 조정) */
const BAND_LOW = 3;
const BAND_HIGH = 7;
const MID = (SCALE_MIN + SCALE_MAX) / 2;
const MAX_CHIPS = 3;
const ANYTHING_CHIP: Chip = { label: '뭐든 좋아', emoji: '🍀' };

export interface RawAnswer {
  questionId: string;
  value?: number;
  optionIds?: string[];
  text?: string;
}

const fail = (questionId: string, message: string): never => {
  throw new ApiError('VALIDATION_ERROR', `${questionId}: ${message}`);
};

function pickOptions(raw: RawAnswer | undefined, questionId: string, allowed: readonly { id: string }[], limit: { min: number; max: number }) {
  const ids = raw?.optionIds ?? [];
  if (new Set(ids).size !== ids.length) fail(questionId, '같은 보기를 두 번 고를 수 없음');
  if (ids.some((id) => !allowed.some((o) => o.id === id))) fail(questionId, '없는 보기가 있음');
  if (ids.length < limit.min || ids.length > limit.max) fail(questionId, `${limit.min}–${limit.max}개를 골라야 함`);
  return ids;
}

/** 15문항 응답 검사: 손대지 않은(빠진) 성향 문항은 미응답으로 거절함 */
export function readAnswers(answers: RawAnswer[]): PersonaAnswers {
  const byId = new Map<string, RawAnswer>();
  for (const a of answers) {
    if (byId.has(a.questionId)) fail(a.questionId, '같은 문항에 두 번 답할 수 없음');
    byId.set(a.questionId, a);
  }
  const known = new Set([...SCALE_QUESTIONS.map((q) => q.id), LIKES_ID, DISLIKES_ID, MUST_KEEP_ID]);
  for (const id of byId.keys()) if (!known.has(id)) fail(id, '없는 문항임');

  const scale: Record<string, number> = {};
  for (const q of SCALE_QUESTIONS) {
    const value = byId.get(q.id)?.value;
    if (value === undefined) fail(q.id, '응답하지 않은 문항임');
    if (!Number.isInteger(value) || value! < SCALE_MIN || value! > SCALE_MAX) fail(q.id, `${SCALE_MIN}–${SCALE_MAX} 사이 정수로 답해야 함`);
    scale[q.id] = value!;
  }
  const text = byId.get(MUST_KEEP_ID)?.text?.trim() ?? '';
  if (text.length > MUST_KEEP_MAX_LENGTH) fail(MUST_KEEP_ID, `${MUST_KEEP_MAX_LENGTH}자 이하여야 함`);
  return {
    scale,
    likes: pickOptions(byId.get(LIKES_ID), LIKES_ID, LIKE_OPTIONS, LIKE_SELECT),
    dislikes: pickOptions(byId.get(DISLIKES_ID), DISLIKES_ID, DISLIKE_OPTIONS, DISLIKE_SELECT),
    mustKeepText: text || null,
  };
}

/** 성향 점수 = ((+)문항 + (10 − (−)문항)) ÷ 2 → 3단계 판정 */
export function scoreTraits(scale: Record<string, number>): TraitResult[] {
  return TRAITS.map((t) => {
    const [plus, minus] = [false, true].map((reverse) => {
      const q = SCALE_QUESTIONS.find((x) => x.trait === t.key && x.reverse === reverse)!;
      return reverse ? SCALE_MAX - scale[q.id] : scale[q.id];
    });
    const score = (plus + minus) / 2;
    const level: TraitLevel = score <= BAND_LOW ? 'low' : score >= BAND_HIGH ? 'high' : 'neutral';
    const pole = level === 'neutral' ? { label: NEUTRAL_LABEL, emoji: '' } : t[level];
    return { key: t.key, name: t.name, score, level, ...pole };
  });
}

/** 카드 칩: '상관없음'을 빼고 5에서 먼 순서로 최대 3개 (동점은 성향 순서) */
export function pickChips(traits: TraitResult[]): Chip[] {
  const chips = traits
    .map((t, order) => ({ t, order, strength: Math.abs(t.score - MID) }))
    .filter(({ t }) => t.level !== 'neutral')
    .sort((a, b) => b.strength - a.strength || a.order - b.order)
    .slice(0, MAX_CHIPS)
    .map(({ t }) => ({ label: t.label, emoji: t.emoji }));
  return chips.length ? chips : [ANYTHING_CHIP];
}

/** 성향별 기본 일정 값 */
const PACE = { low: { places: [2, 3], steps: 10000 }, neutral: { places: [3, 4], steps: 15000 }, high: { places: [5, 6], steps: 20000 } } as const;
const START_TIME = { low: '10:30', neutral: '09:30', high: '08:00' } as const;
const FREE_MINUTES = { low: 90, neutral: 30, high: 0 } as const;
/** 싫어요가 정하는 제한 */
const DISLIKE_LIMIT = { walkSteps: 12000, earliestStart: '09:30', maxCrowd: 80, maxMealPrice: 30000, maxMoveMinutes: 40 } as const;

const minOrSet = (current: number | null, next: number) => (current === null ? next : Math.min(current, next));
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string | null, b: string) => (a === null || b < a ? b : a);

/**
 * 회의용 숨은 값: 성향 기본값 → 14번 싫어요 → 15번 꼭 지킬 것 순서로 덮어씀
 * 같은 종류의 제한(걸음·이동·예산·종료 시각)은 더 엄격한 쪽, 15번의 시작 시각은 직접 쓴 것이므로 그대로 따름
 */
export function buildProfile(traits: TraitResult[], answers: PersonaAnswers, rules: MustKeepRule[]): PersonaProfile {
  const level = (key: string) => traits.find((t) => t.key === key)!.level;
  const weight = (key: string) => {
    const t = traits.find((x) => x.key === key)!;
    return t.level === 'neutral' ? 0 : Math.round(((t.score - MID) / MID) * 100) / 100;
  };
  const pace = PACE[level('pace')];
  const p: PersonaProfile = {
    placesPerDay: [pace.places[0], pace.places[1]],
    maxSteps: pace.steps,
    startTime: START_TIME[level('start')],
    endTime: null,
    freeMinutes: FREE_MINUTES[level('plan')],
    weights: { price: weight('budget'), crowd: weight('vibe'), popularity: -weight('place') },
    maxMoveMinutes: null,
    maxCrowd: null,
    maxMealPrice: null,
    budgetPerPerson: null,
    avoidQueue: false,
    includes: [],
    avoids: [],
    likes: [...answers.likes],
  };

  const d = new Set(answers.dislikes);
  if (d.has('dislike_walk')) p.maxSteps = Math.min(p.maxSteps, DISLIKE_LIMIT.walkSteps);
  if (d.has('dislike_early')) p.startTime = later(p.startTime, DISLIKE_LIMIT.earliestStart);
  if (d.has('dislike_crowd')) p.maxCrowd = DISLIKE_LIMIT.maxCrowd;
  if (d.has('dislike_pricey')) p.maxMealPrice = DISLIKE_LIMIT.maxMealPrice;
  if (d.has('dislike_longmove')) p.maxMoveMinutes = DISLIKE_LIMIT.maxMoveMinutes;
  if (d.has('dislike_queue')) p.avoidQueue = true;

  for (const r of rules) {
    if (r.type === 'include' && r.keyword) p.includes.push(r.keyword);
    if (r.type === 'avoid' && r.keyword) p.avoids.push(r.keyword);
    if (r.type === 'time') {
      if (r.start) p.startTime = r.start;
      if (r.end) p.endTime = earlier(p.endTime, r.end);
    }
    if (r.type === 'budget' && r.amount) p.budgetPerPerson = minOrSet(p.budgetPerPerson, r.amount);
    if (r.type === 'steps' && r.amount) p.maxSteps = Math.min(p.maxSteps, r.amount);
    if (r.type === 'move' && r.amount) p.maxMoveMinutes = minOrSet(p.maxMoveMinutes, r.amount);
  }
  return p;
}
