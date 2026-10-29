import { DISLIKE_OPTIONS, LIKE_OPTIONS } from '../persona/questions.js';
import type { MustKeepRule } from '../persona/types.js';

/**
 * 좋아요·싫어요·꼭 지킬 것을 장소에 맞추는 규칙 (모든 지역에 같은 규칙)
 * 코드는 낱말의 뜻을 해석하지 않음: 장소의 종류는 한국관광공사 공식 분류 코드, 지역은 법정동 코드로만 비교함
 * 사람이 쓴 낱말을 코드로 바꾸는 일은 성향 LLM이 함 (1인 1회). 특정 음식·특정 장소 이름은 2단계 이름 맞추기 LLM이 장소 번호로 맞춤 (names.ts)
 */

export interface RulePlace {
  /** 장소 id (2단계 이름 맞추기(LLM)로 맞춘 곳을 가리킬 때 씀) */
  id?: string;
  title: string;
  /** 공식 분류 코드 (lcls3, 예: EX050100) */
  code: string | null;
  districtCode: string | null;
  isFood: boolean;
  /** 음식점 대표·취급 메뉴 */
  menu: string | null;
}

const inCodes = (code: string | null, prefixes: readonly string[]) => !!code && prefixes.some((p) => code.startsWith(p));

/** 좋아요 보기와 맞는지 (보기마다 정해 둔 공식 분류 코드로만 봄) */
export function likeMatches(likeId: string, p: RulePlace): boolean {
  const opt = LIKE_OPTIONS.find((o) => o.id === likeId);
  return !!opt && inCodes(p.code, opt.codes);
}

/** 싫어요 보기에 걸리는지 (분류 코드가 정해진 보기만, 예: 오래 걷기 → 산·숲·자연공원) */
export function dislikeMatches(dislikeId: string, p: RulePlace): boolean {
  const opt = DISLIKE_OPTIONS.find((o) => o.id === dislikeId);
  return !!opt?.codes && inCodes(p.code, opt.codes);
}

export const likeText = (likeId: string) => LIKE_OPTIONS.find((o) => o.id === likeId)?.text ?? likeId;
export const dislikeText = (dislikeId: string) => DISLIKE_OPTIONS.find((o) => o.id === dislikeId)?.text ?? dislikeId;

/**
 * 먹는 것의 개인 제약 (피할 음식: 회·해산물·고기 등). 10/27 사용자 결정: 알레르기·식단은 끝이 없어 조건으로 받지 않고, 식당은 사람이 최종 선택(14단계)에서 바꿈
 * 새 카드는 만들지 않으며, 예전 카드에 남은 규칙도 후보·식당·AI 반응에 쓰지 않음
 */
export const isDietAvoid = (rule: Pick<MustKeepRule, 'type' | 'target'>) => rule.type === 'avoid' && rule.target === 'food';

/**
 * 장소·음식 이름 규칙인지 (특정 장소·특정 음식, 10/29 사용자 결정 '가'): 코드가 글자로 맞추지 않고 2단계 이름 맞추기 LLM이 고른 장소 번호로만 맞춤
 * target이 없는 예전 규칙(10/14 전 카드)은 장소인지 음식인지 몰라 쓰지 않음 (2단계 메모, 성향을 다시 내면 쓰임)
 */
export const isNameRule = (rule: Pick<MustKeepRule, 'target' | 'keyword'>) => (rule.target === 'place' || rule.target === 'food') && !!rule.keyword?.trim();
/** 지역 규칙인지 (10/29 사용자 결정: 코드가 구·군 이름과 글자로 비교하지 않고 2단계 지역 맞추기 LLM이 구·군 목록 또는 장소 목록에서 번호를 고름, areas.ts) */
export const isAreaRule = (rule: Pick<MustKeepRule, 'target' | 'keyword'>) => rule.target === 'area' && !!rule.keyword?.trim();
export const isLegacyRule = (rule: Pick<MustKeepRule, 'type' | 'target'>) => (rule.type === 'include' || rule.type === 'avoid') && !rule.target;

/**
 * '꼭 지킬 것'의 include·avoid 규칙 하나가 장소를 가리키는지 정하는 함수를 만듦 (코드값만 봄)
 * category: 성향 LLM이 고른 공식 분류 코드 (온천 → EX050100이라 온천천시민공원·온천시장은 해당 없음)
 * 장소·음식 이름(place·food)·지역(area) 규칙과 target이 없는 예전 규칙은 여기서 맞추지 않음 (2단계 LLM이 고른 장소 번호·구·군 코드로 맞춤, retrieve.ts)
 */
export function ruleMatcher(rule: MustKeepRule): (p: RulePlace) => boolean {
  if (rule.target === 'category') {
    const codes = rule.codes ?? [];
    return (p) => inCodes(p.code, codes);
  }
  return () => false;
}
