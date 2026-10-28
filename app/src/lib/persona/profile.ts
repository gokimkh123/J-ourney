import type { KeyValueStore } from '../session/session.ts';
import { isComplete } from './answers.ts';
import { pickChips, scoreTraits } from './scoring.ts';
import type { AnswerState, Chip, Question, Trait } from './types.ts';

/** 여행과 상관없이 한 번만 답하는 성향 문항 수(1~12번). 13번부터는 여행마다 답한다. */
export const PROFILE_QUESTION_COUNT = 12;

/** 이 폰에 저장해 두는 내 성향 답(1~12번의 0~10 점수만). 서버에는 아직 계정 단위 저장이 없어 폰에만 둔다. */
export type Profile = AnswerState;

export type ProfileStore = {
  load(): Promise<Profile | null>;
  save(profile: Profile): Promise<void>;
  clear(): Promise<void>;
  get(): Profile | null;
  subscribe(listener: () => void): () => void;
};

const STORAGE_KEY = 'journey.profile.v1';

export function isProfileQuestion(question: Question): boolean {
  return question.type === 'scale' && question.order <= PROFILE_QUESTION_COUNT;
}

/** 성향 검사에서 묻는 문항(1~12번) */
export function profileQuestions(questions: Question[]): Question[] {
  return questions.filter(isProfileQuestion);
}

/** 파티에서 물어야 하는 문항. 저장된 성향이 있으면 1~12번을 빼고 13번부터만 묻는다. */
export function partyQuestions(questions: Question[], hasProfile: boolean): Question[] {
  return hasProfile ? questions.filter((q) => !isProfileQuestion(q)) : questions;
}

/** 답 전체에서 1~12번 점수만 골라낸다. */
export function extractProfile(questions: Question[], state: AnswerState): Profile {
  const out: Profile = {};
  for (const question of profileQuestions(questions)) {
    const answer = state[question.id];
    if (answer?.type === 'scale') out[question.id] = answer;
  }
  return out;
}

/** 저장된 성향이 문항 12개를 빠짐없이 채우고 있는지. 문항이 바뀌어 모자라면 false(다시 해야 한다). */
export function isProfileComplete(questions: Question[], profile: Profile | null): boolean {
  if (profile === null) return false;
  const needed = profileQuestions(questions);
  return needed.length === PROFILE_QUESTION_COUNT && isComplete(needed, profile);
}

/** 파티에 보낼 답: 저장된 성향 + 이번 파티에서 답한 13번~ */
export function mergeProfile(profile: Profile | null, state: AnswerState): AnswerState {
  return { ...(profile ?? {}), ...state };
}

/** 저장된 점수로 성향 6가지를 다시 계산한다. 점수가 모자라면 null. */
export function profileTraits(profile: Profile | null): Trait[] | null {
  if (profile === null) return null;
  try {
    return scoreTraits(profile);
  } catch {
    return null;
  }
}

/** 성향에서 뽑은 대표 칩(최대 3개). AI가 쓰는 유형명·한마디는 파티 안에서 만들어진다. */
export function profileChips(profile: Profile | null): Chip[] {
  const traits = profileTraits(profile);
  return traits === null ? [] : pickChips(traits);
}

function parseProfile(raw: string | null): Profile | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Profile = {};
  for (const [id, answer] of Object.entries(value as Record<string, unknown>)) {
    if (typeof answer !== 'object' || answer === null) continue;
    const a = answer as Record<string, unknown>;
    if (a.type === 'scale' && typeof a.value === 'number' && Number.isInteger(a.value)) {
      out[id] = { type: 'scale', value: a.value };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function createProfileStore(kv: KeyValueStore): ProfileStore {
  let cache: Profile | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  };
  return {
    async load() {
      cache = parseProfile(await kv.getItem(STORAGE_KEY));
      notify();
      return cache;
    },
    // 메모리를 먼저 바꾸고 저장한다. 저장이 실패해도 이번 실행 동안은 화면이 맞는다.
    async save(profile) {
      cache = { ...profile };
      notify();
      await kv.setItem(STORAGE_KEY, JSON.stringify(cache));
    },
    async clear() {
      cache = null;
      notify();
      await kv.removeItem(STORAGE_KEY);
    },
    get: () => cache,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
