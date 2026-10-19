import { DISLIKE_OPTIONS, LIKE_OPTIONS } from '../persona/questions.js';
import type { MustKeepRule } from '../persona/types.js';
import { normName } from './match.js';

/**
 * 좋아요·싫어요·꼭 지킬 것을 장소에 맞추는 규칙 (모든 지역에 같은 규칙)
 * 코드는 낱말의 뜻을 해석하지 않음: 장소의 종류는 한국관광공사 공식 분류 코드, 지역은 법정동 코드로만 비교함
 * 사람이 쓴 낱말을 코드로 바꾸는 일은 성향 LLM이 함 (1인 1회). 이름으로 찾는 것은 특정 음식·특정 장소뿐
 */

/** 이름으로 찾을 때 최소 글자 수 (한 글자는 '회' → '회관'처럼 다른 말 속에 섞여 있음) */
export const NAME_MIN_CHARS = 2;

export interface RulePlace {
  /** 장소 id (2단계 이름 맞추기(LLM)로 맞춘 곳을 가리킬 때만 씀) */
  id?: string;
  title: string;
  /** 공식 분류 코드 (lcls3, 예: EX050100) */
  code: string | null;
  districtCode: string | null;
  isFood: boolean;
  /** 음식점 대표·취급 메뉴 */
  menu: string | null;
}

export interface RuleContext {
  /** 지역 이름을 지우고 이름을 비교함 (부산 감천문화마을 = 감천문화마을) */
  regionWords: readonly string[];
  /** 시·군·구 이름 → 여행 지역 안의 법정동 코드 */
  districtsOf: (word: string) => readonly string[];
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
 * 장소 이름이 같은지: 이름을 띄어쓰기 단위로 나눈 말 묶음 가운데 하나와 통째로 같을 때만 (글자 포함은 보지 않음)
 * 이재모피자 = '이재모피자 본점', 블루라인파크 = '해운대 블루라인파크', 오사카 ≠ '오사카라멘'
 */
export function sameName(name: string, title: string, regionWords: readonly string[] = []): boolean {
  const key = normName(name, regionWords);
  if (key.length < NAME_MIN_CHARS) return false;
  const words = title.replace(/\(.*?\)|\[.*?\]/g, ' ').trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) if (normName(words.slice(i, j).join(' '), regionWords) === key) return true;
  }
  return false;
}

/**
 * '꼭 지킬 것'의 include·avoid 규칙 하나가 장소를 가리키는지 정하는 함수를 만듦
 * category: 성향 LLM이 고른 공식 분류 코드 (온천 → EX050100이라 온천천시민공원·온천시장은 해당 없음)
 * food: 음식점의 메뉴 칸에 그 음식이 있거나 음식점 이름에 그 음식 이름이 있을 때
 * place: 장소 이름이 같을 때 / area: 그 시·군·구에 있는 장소
 * target이 없는 예전 규칙: 음식 → 장소 이름 순서로만 봄 (종류는 코드가 없어 맞추지 않음)
 */
export function ruleMatcher(rule: MustKeepRule, ctx: RuleContext): (p: RulePlace) => boolean {
  const name = rule.keyword?.trim() ?? '';
  const target = rule.target ?? null;
  if (target === 'category') {
    const codes = rule.codes ?? [];
    return (p) => inCodes(p.code, codes);
  }
  if (!name) return () => false;
  if (target === 'area') {
    const districts = new Set(ctx.districtsOf(name));
    return (p) => !!p.districtCode && districts.has(p.districtCode);
  }
  const food = (p: RulePlace) => p.isFood && (!!p.menu?.includes(name) || (name.length >= NAME_MIN_CHARS && p.title.includes(name)));
  const place = (p: RulePlace) => sameName(name, p.title, ctx.regionWords);
  if (target === 'food') return food;
  if (target === 'place') return place;
  return (p) => food(p) || place(p);
}
